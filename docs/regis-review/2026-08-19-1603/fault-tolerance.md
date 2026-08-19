---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-19-1603
agent: qa-fault-tolerance
generated_at: 2026-08-19T16:03:00-03:00
scope: backend + frontend
score: 7.5
findings_count: 8
cards_count: 6
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta da Frente V)

A Frente V não move dinheiro. O ADR-0038 D2 trava a leitura como única direção do gateway
(`ConexosAprovacoesClient` só expõe `postGeneric` via `runWithRetry` — nenhuma variante `*Once`),
então a classe "duplo débito no ERP" não se aplica. O risco desta frente é diferente e igualmente
caro num painel auditável: **afirmar com números redondos um estado que ninguém consegue provar** —
uma etapa ilegível classificada como `CONCLUIDA`, uma duração estimada em vez de omitida, um
snapshot velho apresentado como fresco.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP | `ftbVldStatus = 7` (valor sem legenda no spec, PV-01) | `EtapaStatusResolver` → `aprovacao_etapa.status` | Backfill em produção | `INDETERMINADO` + lacuna `STATUS_ETAPA_DESCONHECIDO`; valor bruto preservado em `status_erp` | 0 etapas classificadas como `CONCLUIDA` sem mapa; 13/169 etapas reais marcadas como `INDETERMINADO`, não como aprovadas |
| Rede / sessão | Queda no meio do backfill (23.632 títulos na fil. 2 = horas) | Job `ingest-aprovacoes` + `aprovacao_ingestao_run` | Backfill retomável | Cursor gravado APÓS UPSERT do título; `RETOMAR=1` continua da página onde parou | 0 títulos duplicados; ≤ 1 título reprocessado (UPSERT inofensivo); ≥ 12.000 chamadas ao ERP poupadas por queda |
| Concorrência | Duas execuções simultâneas do job | `withAdvisoryLock(APROVACOES_INGEST_LOCK_KEY)` | Cron + `workflow_dispatch` manual coincidem | 2ª execução perde o lock e encerra sem escrever | 0 varreduras concorrentes; quota do ERP não dobrada |
| Ingestão | `finalizar(id,'error',msg)` numa run | `aprovacao_ingestao_run.status='error'` | Falha sistemática do ERP em produção | ⚠️ Marca a linha e emite `console.error`; **nenhum alerta ativo** | MTTD para descobrir backfill quebrado = tempo até um analista notar snapshot velho na UI |
| Domínio | `filCod` errado numa consulta de trilha | `listTrilha` no Conexos devolve `count:0` sem erro (I5) | Ingestão | `IngestaoAprovacoesService` puxa `filCod` do REGISTRO, não da varredura | 0 falsos negativos por default de filial (defesa de projeto) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas do gateway Frente V no ERP | 0 (só `postGeneric` via `runWithRetry`) | 0 | ✅ | `ConexosAprovacoesClient.ts:44-125` |
| Casos `ftbVldStatus = 7` reclassificados como `CONCLUIDA` | 0 (viram `INDETERMINADO`) | 0 | ✅ | `EtapaStatusResolver.ts:42-50` + `EtapaStatusResolver.test.ts:39-44` |
| `DuracaoCalculator.calcularDuracaoSegundos` clampa negativo | Não (retorna `undefined`) | Não | ✅ | `DuracaoCalculator.ts:36-44` |
| UPSERT por chave natural nas escritas de título/etapa | 2/2 (título + etapa) | 100% | ✅ | `TituloAprovacaoRepository.ts:34-84`; `EtapaAprovacaoRepository.ts:40-100` |
| Transação envolvendo `sincronizarTrilha` | Sim (`withTransaction`) | Sim | ✅ | `EtapaAprovacaoRepository.ts:44-98` |
| Cursor gravado após persistência do título | Sim | Sim | ✅ | `IngestaoAprovacoesService.ts:109-118`; `AprovacaoIngestaoRunRepository.ts:47-70` |
| Exclusão mútua cross-processo | `pg_try_advisory_lock(918273649)` | Presente | ✅ | `ingest-aprovacoes.ts:78-93`; `PostgreeDatabaseClient.ts:137-158` |
| Retry no cliente Conexos | 2 tentativas + jitter 200 ms | ≥ 1 retry | ✅ | `ConexosBaseClient.ts:154-160` |
| Testes de idempotência/retomada (`IngestaoAprovacoesService.test.ts`) | 8 casos (inclui "erro marca run" e "retoma da página") | ≥ 5 cenários | ✅ | `IngestaoAprovacoesService.test.ts:146-247` |
| Cron scheduled para `job:ingest-aprovacoes` | **AUSENTE** (só `extratos`, `permutas`, `sispag` têm `.yml`) | Presente | ❌ | `.github/workflows/` (nenhum `ingest-aprovacoes.yml`) |
| Alerta ativo em `aprovacao_ingestao_run.status='error'` | Nenhum callsite consome esse estado | Presente | ❌ | `grep aprovacao_ingestao_run src/backend` — só o próprio repositório |
| Reaper de runs em `status='running' AND finished_at IS NULL` | Nenhum — só `ultimaRunRetomavel()` que serve à retomada, não ao alerta | Presente | ⚠️ | `AprovacaoIngestaoRunRepository.ts:75-89` |
| `snapshotEm` no grid | `MAX(observado_em)` **global**, não por filial | Idade por filial visível | ⚠️ | `TituloAprovacaoRepository.ts:179-184` |
| Condição-monitoramento para novos valores desconhecidos de `ftbVldStatus` | Lacuna aparece na UI, sem alerta ativo | Alerta / contador | ⚠️ | `EtapaStatusResolver.ts:45-49` (fail-safe presente; detecção ativa ausente) |
| Reconciliação Conexos × Postgres (spot check periódico) | Ausente | Presente (P1 na doutrina do painel) | ⚠️ | Ausência de job/rota |
| Cobertura de testes do serviço de ingestão | 8 casos executáveis | ≥ 5 | ✅ | `grep -c "it(" IngestaoAprovacoesService.test.ts` = 8 |

> ⚠️ **Não medível localmente** (flag `--quick`): timeout efetivo por requisição do Conexos — a
> política de timeout mora no `LegacyConexosShape` injetado no `ConexosBaseClient`; medir exigiria
> instrumentar CloudWatch ou o cliente HTTP legado, ambos fora do escopo desta run.

## 3. Tactics — Cobertura no delta da Frente V

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** | N/A — a Frente V é read-only por ADR-0038 D2; não há caminho de escrita externa que precise de rota alternativa | N/A | ADR-0038 D2 |
| **Replacement** | Gateway abstraído por `TRILHA_APROVACAO_GATEWAY_TOKEN` — trocar `psq014+fin026` por uma varredura via `fin103` (quando PV-07 fechar) é trocar o binding | ✅ | `IngestaoAprovacoesService.ts:57-74` |
| **Predictive Model** | N/A — não há previsão de carga; o custo do backfill é linear e conhecido | N/A | — |
| **Increase Competence Set** | `EtapaStatusResolver` reconhece o valor bruto de `ftbVldStatus` mesmo sem mapa e o guarda em `status_erp` para reclassificação futura via migration, sem reingestão | ✅ | `EtapaStatusResolver.ts:42-50`; `0049_aprovacao_trilha.sql:80-83`; regra `status-etapa-fail-safe.md` |
| **Sanity Checking** | (a) `EtapaStatusResolver` rejeita status/ação desconhecidos → `INDETERMINADO`; (b) `DuracaoCalculator` rejeita `agidoEm ≤ recebidoEm` → `undefined` (não clampa negativo para zero, propositalmente); (c) `AprovacoesPainelService.parseId` recusa `+1`, `1.0`, `1e3`, vazio; (d) rota Zod-validada no boundary | ✅ | `EtapaStatusResolver.ts:34-73`; `DuracaoCalculator.ts:36-44`; `AprovacoesPainelService.ts:202-213`; `routes/aprovacoes.ts:63-85` |
| **Comparison** | Snapshot preserva `status_erp` bruto para comparação futura; mas não há comparação ativa (spot-check ERP × Postgres) — ver F-fault-tolerance-6 | ⚠️ | `0049_aprovacao_trilha.sql:80-83` |
| **Timestamp** | `observado_em` obrigatório em cada linha (I7), exibido na UI; `started_at`/`finished_at` na run | ✅ | `0049_aprovacao_trilha.sql:47-49,145-146`; `snapshot-faixa.tsx` |
| **Timeout** | `RetryExecutor` embute delay de 500 ms + jitter no `ConexosBaseClient`; timeout HTTP fica no legado (não medível em `--quick`) | ⚠️ | `ConexosBaseClient.ts:154-160` |
| **Condition Monitoring** | Lacunas propagadas até a UI e contadas no chip "Com lacunas"; **não há** alerta automático quando aparece novo `ftbVldStatus` desconhecido nem quando `aprovacao_ingestao_run.status='error'` | ⚠️ | `page.tsx:376-381`; F-fault-tolerance-2 e F-fault-tolerance-4 |
| **Self-Test** | Testes unitários cobrem 8 cenários do serviço de ingestão (inclui `status desconhecido`, `filCod do registro`, `retomada`, `run erro`); nenhum probe rodando em produção | ⚠️ | `IngestaoAprovacoesService.test.ts:146-247` |
| **Voting** | N/A — fonte única de verdade (Conexos) | N/A | — |
| **Redundancy** | N/A na leitura (não há réplica de ERP); `advisory lock` protege contra "redundância acidental" — 2 runs concorrentes | ✅ | `ingest-aprovacoes.ts:78-93` |
| **Recovery — Rollback (transacional)** | `withTransaction` no `sincronizarTrilha`: UPSERT das etapas + inativação da complementar rodam atômico por título | ✅ | `EtapaAprovacaoRepository.ts:44-98` |
| **Recovery — Repair State** | `status_erp` bruto guardado permite migration `UPDATE ... WHERE status_erp = 7` sem reingerir | ✅ | Regra `status-etapa-fail-safe.md` § "Por que o valor bruto é preservado" |
| **Idempotent Replay** | UPSERT por chave natural (título e etapa); cursor gravado após persistência; reprocessar o mesmo título nunca duplica linha | ✅ | `TituloAprovacaoRepository.ts:34-84`; `EtapaAprovacaoRepository.ts:44-83`; `IngestaoAprovacoesService.ts:109-118` |
| **Compensating Transaction** | N/A — frente é read-only; não há efeito externo a compensar | N/A | ADR-0038 D2 |
| **Reconcile** | Ausente — nenhum job periódico consulta o ERP e compara com o snapshot local | ❌ | F-fault-tolerance-6 |
| **Quarantine** | Etapa/título com `INDETERMINADO` fica destacada na UI (badge + chip "Com lacunas") como caixa de quarentena visual; run em `error` marca o campo mas não isola execuções futuras | ⚠️ | `page.tsx:376-381`; `AprovacaoIngestaoRunRepository.ts:72-82` |
| **Reintroduction — Shadow / State Resync / Escalating Restart** | Retomada de run pelo cursor é a state resync canônica; nenhum shadow-run; nenhum escalating restart automático (o operador reenvia `RETOMAR=1`) | ⚠️ | `IngestaoAprovacoesService.ts:76-119`; `ingest-aprovacoes.ts:47-49` |

## 4. Findings

### F-fault-tolerance-1: Job `ingest-aprovacoes` sem cron agendado

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring (cadência automática ausente); indiretamente Repair State — sem cadência, `observado_em` nunca envelhece "graciosamente"
- **Localização**: `.github/workflows/` (arquivo `ingest-aprovacoes.yml` inexistente); `src/backend/package.json:21`; `src/backend/jobs/ingest-aprovacoes.ts:1-120`
- **Evidência (objetiva)**:
  ```
  $ ls C:/tmp/frente-v-wt/.github/workflows/
  ci.yml
  ingest-extratos.yml
  ingest-permutas.yml
  ingest-sispag.yml
  # sem ingest-aprovacoes.yml
  ```
  As demais frentes têm workflow explícito com `schedule: cron`; a Frente V só tem
  `npm run job:ingest-aprovacoes` como entrada manual.
- **Impacto técnico**: o snapshot da Frente V envelhece indefinidamente sem intervenção manual. A
  `SnapshotFaixa` mostra "não é o ERP ao vivo", mas isso pressupõe que ALGUÉM está reingerindo — a
  UI não distingue "cron rodou hoje às 03:00 e trouxe o estado atual" de "última run foi há 40 dias
  porque ninguém disparou".
- **Impacto de negócio**: analista abre o painel e vê `AGUARDANDO` para títulos que já foram
  aprovados no ERP dias antes; a decisão que ele toma (cobrar aprovador, escalar) é sobre um mundo
  que não existe mais.
- **Métrica de baseline**: 0 execuções agendadas de `job:ingest-aprovacoes` no repositório versus 3
  workflows-cron nas outras frentes de ingestão.

### F-fault-tolerance-2: `aprovacao_ingestao_run.status='error'` sem alerta ativo

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:72-82`;
  `src/backend/jobs/ingest-aprovacoes.ts:96-100`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "aprovacao_ingestao_run" src/backend --include='*.ts' | grep -v test | grep -v dist
  src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:26
  src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:46
  src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:62
  src/backend/domain/repository/aprovacoes/AprovacaoIngestaoRunRepository.ts:79
  # sem qualquer leitura de status='error' em nenhum job/rota/dashboard.
  ```
  A run é marcada com `error_message`, mas `console.error(...)` no `catch` do `main` do job é o
  único sinal — quando o job roda por cron a saída de log não vira ticket automático.
- **Impacto técnico**: falhas sistemáticas do ERP (mudança de rota, expiração de credencial,
  quebra de sessão) marcam runs consecutivas em erro sem que ninguém saiba.
- **Impacto de negócio**: o backfill que deveria abastecer o painel congela silenciosamente; combina
  com F-fault-tolerance-1 para produzir "painel confiante e defasado", que é exatamente o cenário
  que a regra `status-etapa-fail-safe` foi desenhada para evitar — só que aplicado à idade do dado,
  não ao status da etapa.
- **Métrica de baseline**: 0 rotas/leitores de `aprovacao_ingestao_run.status='error'`. MTTD atual
  = tempo até um analista notar o `SnapshotFaixa` velho na tela.

### F-fault-tolerance-3: `ultimoSnapshot()` usa `MAX(observado_em)` global — pode ocultar filial defasada

- **Severidade**: P2
- **Tactic violada**: Timestamp (a idade certa) / Condition Monitoring (por escopo do usuário)
- **Localização**: `src/backend/domain/repository/aprovacoes/TituloAprovacaoRepository.ts:179-184`
- **Evidência (objetiva)**:
  ```
  public ultimoSnapshot = async (): Promise<Date | null> => {
      const row = await this.databaseClient.selectFirst<{ observado_em: string | null }>(
          'SELECT MAX(observado_em) AS observado_em FROM aprovacao_titulo',
      );
      ...
  };
  ```
  A rota `GET /aprovacoes` recebe `filCods` (allow-list do usuário) mas o `snapshotEm` devolvido
  vem de `MAX` sobre **toda a tabela**, sem filtro por `fil_cod` nem pelo `filCods` do filtro.
- **Impacto técnico**: se a filial 3 acabou de ser ingerida mas a filial do usuário logado
  (fil. 5) não é reingerida há 30 dias, o `SnapshotFaixa` do usuário mostra "há alguns minutos"
  quando na verdade os títulos que ele está vendo estão parados há 30 dias.
- **Impacto de negócio**: recria, num nível diferente, o mesmo erro que a regra
  `status-etapa-fail-safe` combate — afirmar frescor sobre dado velho. Baixo probabilidade hoje
  (uma filial só) mas alto no momento em que a frente cobrir múltiplas filiais.
- **Métrica de baseline**: 1 query global (`SELECT MAX(observado_em) FROM aprovacao_titulo`) vs 0
  por-filial; o `TrilhaResponse.snapshotEm` do detalhe usa o `observado_em` DO título (correto,
  ver `AprovacoesPainelService.detalhar`), mas o grid não.

### F-fault-tolerance-4: Novo valor de `ftbVldStatus` desconhecido não gera alarme

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring, Self-Test
- **Localização**: `src/backend/domain/service/aprovacoes/EtapaStatusResolver.ts:42-50`;
  ausência de contador/probe consumindo `lacunas @> ['STATUS_ETAPA_DESCONHECIDO']`
- **Evidência (objetiva)**:
  ```
  const mapeado = statusErp === undefined ? undefined : ETAPA_STATUS_ERP[statusErp];
  if (mapeado === undefined) {
      lacunas.push(LACUNA.STATUS_ETAPA_DESCONHECIDO);
      return { status: ETAPA_STATUS.INDETERMINADO, lacunas };
  }
  ```
  O caminho fail-safe é sólido (registra a lacuna, preserva o bruto, badge visível). Mas nenhum
  callsite conta quantos `INDETERMINADO` novos aparecem por dia; a UI mostra "Com lacunas: N" na
  página atual, sem série temporal.
- **Impacto técnico**: um novo enum do ERP (por ex. `ftbVldStatus = 8`) aparece silenciosamente
  como `INDETERMINADO` e vira "operação normal". A pendência PV-01 nunca fecha porque ninguém
  descobre que o problema mudou.
- **Impacto de negócio**: perda gradual de significado do badge `INDETERMINADO`. Quando o chip
  passa de 7,7% para 30%, o painel deixa de ser útil e o cliente reclama do produto — não da
  degradação do ERP.
- **Métrica de baseline**: 0 dashboards/queries que agregam `STATUS_ETAPA_DESCONHECIDO` no tempo;
  1 chip visual local à página.

### F-fault-tolerance-5: Corrida entre `iniciar()` e `ultimaRunRetomavel()` no bootstrap

- **Severidade**: P3
- **Tactic violada**: State Resync (correção de borda)
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:76-93`
- **Evidência (objetiva)**:
  ```
  const retomada = params.retomar ? await this.runRepository.ultimaRunRetomavel() : null;
  ...
  if (!retomada) {
      await this.runRepository.iniciar({ id: runId, ..., status: 'running', ... });
  }
  ```
  Duas invocações **sem** `RETOMAR=1` seriam serializadas pelo `withAdvisoryLock`, então o cenário
  patológico não ocorre no caminho do job. Mas se algum outro chamador (ex.: teste, rota
  administrativa futura) executar o serviço sem passar pelo lock, dois `iniciar()` concorrentes
  criam duas linhas em `running` e, na próxima retomada, `ultimaRunRetomavel()` (`ORDER BY
  started_at DESC LIMIT 1`) escolhe a mais recente e ignora a outra — que fica órfã em
  `running` para sempre.
- **Impacto técnico**: linhas fantasmas em `aprovacao_ingestao_run`; poluição do painel de
  auditoria futuro.
- **Impacto de negócio**: baixo enquanto o job for a única entrada, mas eleva o custo de qualquer
  rota administrativa futura (F1.2 de trigger manual pela UI).
- **Métrica de baseline**: 1 caminho de entrada protegido (job); 0 restrição de invocação direta
  do serviço (não há erro se alguém chamar sem lock).

### F-fault-tolerance-6: Sem reconciliação Conexos × Postgres

- **Severidade**: P2
- **Tactic violada**: Reconcile, Comparison
- **Localização**: ausência de arquivo — não há job/rota que compare uma amostra do ERP com o
  snapshot local
- **Evidência (objetiva)**:
  ```
  $ grep -rn "reconcil" src/backend/domain/service/aprovacoes src/backend/jobs
  # sem hits para reconciliação da Frente V
  ```
- **Impacto técnico**: um bug de mapeamento (ex.: `docTip` errado numa varredura, ordem de
  paginação regredindo) pode gravar títulos com trilha "vazia" enquanto o ERP tem trilha. Como o
  status `SEM_WORKFLOW` cobre ~50% dos títulos legitimamente, um erro do tipo se dilui e não
  aparece.
- **Impacto de negócio**: divergência silenciosa entre "o painel diz" e "o ERP diz" — o cliente
  descobre por acaso. Menor que na Frente II (não há dinheiro em jogo), mas erode a confiança que
  é o produto entregue pela Frente V.
- **Métrica de baseline**: 0 checagens periódicas de "sample de N títulos do ERP vs snapshot"; 0
  alertas quando `count` do `psq014/list` diverge de `count(*)` do snapshot na mesma janela de
  emissão.

### F-fault-tolerance-7: Reaper de run travada em `running` ausente

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring, Escalating Restart
- **Localização**: `AprovacaoIngestaoRunRepository.ts:75-89` — a query `ultimaRunRetomavel()`
  existe para servir à **retomada**, não à detecção
- **Evidência (objetiva)**:
  ```
  WHERE status = 'running' AND finished_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
  ```
  Uma run cujo processo morreu SIGKILL sem catch fica em `running` para sempre. O `RETOMAR=1` só
  recupera se o operador souber que precisa; nada notifica que existe uma "abandonada há > N h".
- **Impacto técnico**: métricas de auditoria (tempo médio de backfill, taxa de sucesso) ficam
  contaminadas por runs zumbi.
- **Impacto de negócio**: baixo hoje (ninguém consome esses números), alto quando a auditoria da
  Fase 2 pedir SLA de disponibilidade do painel.
- **Métrica de baseline**: 0 jobs/consultas verificando `started_at < now() - interval 'X hours'
  AND status='running'`.

### F-fault-tolerance-8: Bootstrapping do container antes do lock — vazamento parcial em falha precoce

- **Severidade**: P3
- **Tactic violada**: Recovery — Rollback
- **Localização**: `src/backend/jobs/ingest-aprovacoes.ts:53-93`
- **Evidência (objetiva)**:
  ```
  await bootstrapAppContainer();
  ...
  const resultado = await db.withAdvisoryLock(APROVACOES_INGEST_LOCK_KEY, async () => ...);
  ```
  Se `bootstrapAppContainer()` (ou o `db.withAdvisoryLock` antes de `pg_try_advisory_lock`)
  falhar após `resolverFilCods()`, nenhuma linha em `aprovacao_ingestao_run` é criada; o operador
  não vê a run que "tentou existir". O comportamento é seguro (nada corrompido), mas nada é
  registrado — MTTD depende do log do runner.
- **Impacto técnico**: perda de observabilidade em falhas de bootstrap.
- **Impacto de negócio**: baixo — cai em log do CI/Render.
- **Métrica de baseline**: 0 registros em `aprovacao_ingestao_run` para runs que falham antes de
  entrar no serviço; 100% dependência do log externo.

## 5. Cards Kanban

### [fault-tolerance-1] Publicar workflow GitHub Actions com cron diário para `ingest-aprovacoes`

- **Problema**
  > O job `job:ingest-aprovacoes` só tem entrada manual (`workflow_dispatch`) e é o único das 4
  > frentes de ingestão sem `.yml` de cron. Sem cadência automática, o `SnapshotFaixa` diz "não é
  > ao vivo" sem que a UI possa distinguir "snapshot de hoje" de "snapshot de mês passado".

- **Melhoria Proposta**
  > Criar `.github/workflows/ingest-aprovacoes.yml` espelhando `ingest-sispag.yml`, com horário
  > que não conflite com Permutas (09:00 UTC) e SISPAG (10:00 UTC) — sugerido 11:00 UTC (08:00
  > BRT). Tactic: Condition Monitoring (cadência) + Repair State (snapshot renovado).

- **Resultado Esperado**
  > Painel abastecido 1x/dia sem intervenção humana. `snapshotEm` no grid nunca mais velho que
  > 24h em cenário-feliz.

- **Tactic alvo**: Condition Monitoring, Repair State
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Workflows cron para ingestão da Frente V: 0 → 1
  - Idade máxima do snapshot em produção (P95 durante 30 dias): irrelevante hoje → ≤ 26h
- **Risco de não fazer**: painel entra em produção com dado congelado após o primeiro backfill
  manual; analista toma decisão sobre estado desatualizado; combinado com F-fault-tolerance-2,
  ninguém percebe.
- **Dependências**: `RETOMAR=1` já implementado; secret de conexão já existe (reaproveitar do
  workflow do SISPAG).

### [fault-tolerance-2] Alertar em `aprovacao_ingestao_run.status='error'`

- **Problema**
  > `finalizar(id,'error',msg)` grava o motivo mas nenhum consumidor lê essa coluna em produção.
  > Um backfill que falhar 3 dias seguidos é indistinguível para o operador de um backfill que
  > não foi disparado.

- **Melhoria Proposta**
  > Duas opções combináveis, ambas cheap: (a) fazer o workflow do card 1 falhar quando o job sair
  > com `exit(1)`, produzindo notificação nativa de GitHub Actions; (b) adicionar rota
  > `GET /aprovacoes/health/last-run` que devolve a última run e o painel (ou um probe externo)
  > pinta um selo vermelho no header quando ela vier em `error`. Tactic: Condition Monitoring.

- **Resultado Esperado**
  > MTTD de backfill quebrado cai de "quando um analista abrir a UI e reclamar" para "no dia
  > seguinte à falha".

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-7
- **Métricas de sucesso**:
  - Consumidores ativos de `aprovacao_ingestao_run.status='error'`: 0 → ≥ 1
  - MTTD estimado de falha sistemática: dias → 24h
- **Risco de não fazer**: painel envelhece silenciosamente e o cliente descobre por conta própria;
  reincide a mesma classe de erro que a regra `status-etapa-fail-safe` foi desenhada para evitar,
  em outro nível.
- **Dependências**: card 1 (o workflow torna trivial (a)).

### [fault-tolerance-3] `snapshotEm` do grid deve refletir a filial em foco

- **Problema**
  > `TituloAprovacaoRepository.ultimoSnapshot()` faz `SELECT MAX(observado_em) FROM
  > aprovacao_titulo` sem filtrar por `fil_cod`. Quando a Frente V cobrir múltiplas filiais com
  > cadências diferentes, o grid dirá "há minutos" enquanto os títulos exibidos foram lidos há
  > semanas.

- **Melhoria Proposta**
  > Estender `ultimoSnapshot(filCods?: number[])` e chamá-la a partir de `AprovacoesPainelService`
  > passando o `filtro.filCods`. Devolver **min** ou **max** por filial-alvo é decisão de
  > produto — `min` é mais honesto (o mais velho na visão que o usuário tem). Tactic: Timestamp.

- **Resultado Esperado**
  > `snapshotEm` do grid = idade real do dado apresentado ao usuário logado.

- **Tactic alvo**: Timestamp
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Divergência entre `snapshotEm` do grid e `observado_em` mediano dos títulos da página: hoje
    imensurável → ≤ 1h
- **Risco de não fazer**: reproduz o pecado que a regra do fail-safe combate (afirmação
  falsamente redonda) no nível da meta-informação da UI.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Instrumentar contagem histórica de `STATUS_ETAPA_DESCONHECIDO`

- **Problema**
  > Quando um novo `ftbVldStatus` aparecer no ERP, o pipeline continua funcionando: fail-safe.
  > Mas nenhuma métrica temporal denuncia isso. Se o percentual de `INDETERMINADO` subir de 7,7%
  > para 30% ao longo de meses, ninguém percebe até um cliente reclamar.

- **Melhoria Proposta**
  > (a) View SQL com contagem diária de etapas por `status` e `status_erp`; (b) na resposta do
  > `GET /aprovacoes` adicionar `contadores.indeterminado_no_universo` e comparar com o filtrado
  > para dar contexto no chip "Com lacunas". Tactic: Condition Monitoring + Self-Test.

- **Resultado Esperado**
  > Alarme quando `count(*) FILTER (WHERE status='INDETERMINADO') / count(*)` do dia varia > X pp
  > vs a média dos últimos 30 dias.

- **Tactic alvo**: Condition Monitoring, Self-Test
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Dashboards temporais consumindo `status = 'INDETERMINADO'`: 0 → 1
  - Alarme de drift no percentual: ausente → thresholded
- **Risco de não fazer**: PV-01 nunca fecha porque a evidência para reabrir a discussão não é
  coletada.
- **Dependências**: nenhuma.

### [fault-tolerance-5] Reaper para runs em `status='running'` há > 6h

- **Problema**
  > Uma run que morreu SIGKILL fica em `running` para sempre. `ultimaRunRetomavel()` retoma essa
  > run automaticamente com `RETOMAR=1`, mas o operador não sabe que existe uma abandonada — e
  > sem `RETOMAR=1` (que é opt-in), a linha vira zumbi.

- **Melhoria Proposta**
  > Migration com job SQL agendado (ou uma checagem no início do `main` do próprio job) que
  > marca como `error` (com `error_message='reaped'`) runs em `running` com `started_at < now() -
  > interval '6 hours'`. Complementa o card 2 — a mesma rota `/health/last-run` já detecta.
  > Tactic: Condition Monitoring, Escalating Restart.

- **Resultado Esperado**
  > 0 runs zumbi em produção; alerta do card 2 dispara também para o cenário "processo morreu
  > sem catch".

- **Tactic alvo**: Condition Monitoring, Escalating Restart
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5, F-fault-tolerance-7
- **Métricas de sucesso**:
  - Runs em `running` com `started_at < now() - 6h`: hoje sem monitor → 0 estáveis
- **Risco de não fazer**: métricas de auditoria da Fase 2 nascerão contaminadas por runs zumbi.
- **Dependências**: card 2 idealmente antes (compartilha rota de saúde).

### [fault-tolerance-6] Reconciliação amostral Conexos × Postgres

- **Problema**
  > Bugs de projeção/paginação/mapeamento podem produzir divergência silenciosa entre snapshot e
  > ERP (por ex.: título que existe no `psq014` sem entrar na tabela local). O `SEM_WORKFLOW`
  > legítimo em ~50% dos títulos mascara esse tipo de falha.

- **Melhoria Proposta**
  > Job semanal que, para cada filial, roda `psq014/list count` numa janela de emissão e compara
  > com `SELECT COUNT(*) FROM aprovacao_titulo WHERE fil_cod=... AND data_emissao BETWEEN ...`.
  > Divergência > 1% gera lacuna no cabeçalho do painel. Tactic: Reconcile, Comparison.

- **Resultado Esperado**
  > Divergência estrutural entre ERP e Postgres torna-se visível dentro de 7 dias.

- **Tactic alvo**: Reconcile, Comparison
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Freq. de reconciliação: 0 → 1x/semana por filial
  - Divergência tolerada sem alerta: ilimitada → ≤ 1%
- **Risco de não fazer**: erosão silenciosa da confiança no painel; um bug sutil pode entregar
  cobertura 90% do universo pensando estar em 99%.
- **Dependências**: card 1 (cron infrastructure) — pode compartilhar workflow.

## 6. Notas do agente

- Escopo confirmado: apenas o delta da Frente V. Frentes I/II/IV foram tratadas em runs
  anteriores e ficam fora daqui — o CLAUDE.md e os `_shared-metrics` estão coerentes.
- A hipótese "read-only ⇒ zero risco de fault tolerance" foi rejeitada explicitamente:
  substitui-se o risco de duplo-débito pelo risco de **afirmação falsamente redonda**, e o
  scoring reflete isso.
- Métricas não coletadas em `--quick`: timeout HTTP efetivo do `LegacyConexosShape` (P2 latente,
  mas ver `qa-availability` e `qa-performance`) e cobertura por linha do delta (não pedido).
- Cross-QA para o consolidator:
  - **qa-availability**: F-1 e F-2 são o mesmo achado por ângulos diferentes — cadência de cron
    e alerta de erro. Consolidar sem duplicar cards.
  - **qa-testability**: cenários de retomada (`IngestaoAprovacoesService.test.ts:205-232`)
    cobrem a state resync; nenhum teste E2E cobre "duas runs concorrentes" fora do teste unitário
    do `PostgreeDatabaseClient`.
  - **qa-security**: `snapshotEm` global (F-3) tem componente de vazamento de sinal cross-filial
    baixo — a idade não é confidencial, mas a coerência com `filialAuthz` merece nota.
  - **qa-integrability**: `EtapaStatusResolver` como ponto único de tradução do enum do Conexos
    é uma decisão de fault tolerance que também barateia a integração — sinalizar sinergia.
