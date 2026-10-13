---
qa: Availability
qa_slug: availability
run_id: 2026-10-13-2014
agent: qa-availability
generated_at: 2026-10-13T20:30:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

> Escopo: delta `git diff 5a17d3e HEAD` (sincronização do pool DDA dentro da ingestão de pagamentos). Código legado fora do delta não foi avaliado.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron (07h/12h/16h BRT), abertura de tela (TTL 30 min) ou botão manual | `fin124` (DDA) lento, indisponível, sessão do robô no cap, ou outra sincronização DDA já rodando | `IngestaoPagamentosService.runIngestion` → `BoletoDdaService.sincronizar` | Operação normal, ingestão com advisory lock próprio, ~10 s medidos no cron (comentário `IngestaoPagamentosService.ts:25`) | Ingestão conclui a carteira de títulos; DDA vira `sincronizado/parcial/ocupada/falhou` na run e no log; pool anterior preservado | 0 ingestões derrubadas por falha DDA; passada DDA limitada a 60 s (`DDA_PRAZO_NA_INGESTAO_MS`); estado do pool visível ao analista |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Falha/lock/prazo DDA propaga erro para a ingestão | 0 caminhos (`try/catch` cobre `sincronizar` inteiro; `IngestLockBusyError` → `ocupada`) | 0 | ✅ | `IngestaoPagamentosService.ts:~206-222` |
| Chamadas externas novas dentro do delta sem Executor próprio | 1 (`sincronizar`); retry herdado de `ConexosDdaClient` via `base.runWithRetry` (`ConexosDdaClient.ts:119`) | 100% sob retry/timeout | ✅ | `ConexosDdaClient.ts:119` |
| Timeout explícito do cliente HTTP Conexos | 40 000 ms por chamada (`services/conexos.ts:121`) | 100% com timeout | ✅ | `grep timeout src/backend/services/conexos.ts` |
| Orçamento DDA efetivamente limitado ao prazo | ⚠️ Parcial: prazo só é checado no início de cada arquivo (`BoletoDdaService.ts:~139`); `listarArquivos` e os até 3 arquivos em voo (`FANOUT_LIMIT = 3`, linha 29) não são cortados | Teto rígido | ⚠️ | `BoletoDdaService.ts:121-141` |
| Cobertura de testes dos estados DDA na ingestão | 4 casos novos (sincronizado, parcial por prazo, falhou, ocupada) | todos os estados | ✅ | `IngestaoPagamentosService.test.ts:146-203` |
| Testes backend | 230 suites / 4081 passando | verde | ✅ | `_shared-metrics.md` |
| Alarmes CloudWatch / DLQ / `infra/` | N/A: `infra/` não existe neste repo | — | ⚠️ | CLAUDE.md (Layout) |

> ⚠️ **Não medível localmente**: duração real da passada DDA dentro da ingestão (p50/p95), taxa de `parcial/falhou/ocupada` em produção, MTTR do pool defasado. Requer logs de produção (Render) / consulta à tabela de runs (`error_message`). Recomendação: contar `dda.estado` por run e a duração da fase DDA como campo estruturado do log `business_info`.

> ⚠️ **Não medível localmente**: tempo de pior caso da ingestão com DDA. A composição é 60 s (prazo) + arquivos em voo (até 3 × leituras paginadas, cada chamada até 40 s com retry) + ~10 s de títulos; nenhum desses valores foi observado em produção.

## 3. Tactics — Cobertura (escopo do delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Ausente; não há sonda ativa do `fin124` | ❌ ausente | N/A no delta |
| Heartbeat | Ausente; as 3 execuções diárias do cron funcionam como pulso implícito | ❌ ausente | `ingest-sispag.yml` |
| Monitor | WARN `sincronização DDA parcial/falhou` + `error_message` da run + `::warning::` no job + aviso de pool > 8 h na aba | ⚠️ parcial | `IngestaoPagamentosService.ts:~207,~219`; `ingest-pagamentos.ts:30-45`; `ddaDefasado.ts` |
| Timestamp | `sincronizadoEm` (última sincronização) exposto e usado para detectar defasagem | ✅ presente | `BoletoDdaService.ts:~83-96`; `BoletosDdaTab.tsx` |
| Sanity Checking | Estado tipado `DDA_NA_INGESTAO`; contagem de falhas/adiados vs. total | ⚠️ parcial | `SispagInterface.ts`; sem checagem de "0 boletos lidos é suspeito" |
| Condition Monitoring | Idade do pool > 8 h em dia útil no frontend | ⚠️ parcial | `ddaDefasado.ts` |
| Voting | N/A: fonte única do DDA, sem réplicas computando o mesmo resultado | N/A | — |
| Exception Detection | `catch` distingue `IngestLockBusyError` de falha real; falha parcial por arquivo contada em `falhas` | ✅ presente | `IngestaoPagamentosService.ts:~216-221`; `BoletoDdaService.ts:~148-160` |
| Self-Test | Ausente | ❌ ausente | — |
| Active Redundancy | N/A: job único por design, advisory lock garante um executor | N/A | — |
| Passive Redundancy | N/A: sem réplica do pool; a tabela `boleto_dda` mantida é o "estado anterior" | N/A | — |
| Spare | N/A: sem instâncias sobressalentes (Render monolítico, sem `infra/`) | N/A | — |
| Exception Handling | Enriquecimento nunca derruba a carteira; falha DDA vira estado + aviso | ✅ presente | `IngestaoPagamentosService.ts:200-222` |
| Rollback | Pool anterior mantido na falha; UPSERT com `COALESCE` não apaga `doc_esp_numero`; `salvarArquivo` por arquivo | ✅ presente | `TituloAPagarRepository.ts:133`; `BoletoDdaService.ts` |
| Software Upgrade | Migration `0083` aditiva (coluna nullable), compatível com versão anterior do código | ✅ presente | `0083_titulo_doc_esp_numero.sql` |
| Retry | Herdado do client (`runWithRetry`); a ingestão não retenta o DDA, o próximo ciclo (cron/TTL 30 min) cobre | ✅ presente | `ConexosDdaClient.ts:119` |
| Ignore Faulty Behavior | Arquivo com falha é contado e pulado; demais seguem | ✅ presente | `BoletoDdaService.ts:~148` |
| Degradation | Carteira entregue com pool defasado, estado `parcial/falhou` explícito e aviso ao analista; novos primeiro | ✅ presente | `BoletoDdaService.ts:123-127`; `avisoDaRun` |
| Reconfiguration | Parâmetros `prazoMs`/`releituraDias` por chamada; manual e avulso sem prazo | ⚠️ parcial | `BoletoDdaService.ts:90-100`; prazo é constante, não configurável por env |
| Shadow | N/A: sem modo sombra/rollout gradual da fase DDA na ingestão | N/A | — |
| State Resynchronization | Releitura dos últimos `RELEITURA_DIAS` + "novos primeiro" ressincroniza o pool na rodada seguinte | ✅ presente | `BoletoDdaService.ts:~120-128` |
| Escalating Restart | N/A: sem reinício escalonado (processo Render/cron) | N/A | — |
| Non-Stop Forwarding | A ingestão segue sem esperar o pool completo; `ocupada` não bloqueia | ✅ presente | `IngestaoPagamentosService.ts:~216` |
| Removal from Service | N/A: sem circuit breaker; a fase DDA não é removida após falhas consecutivas | ❌ ausente | ver F-availability-2 |
| Transactions | `salvarArquivo(arquivo, itens)` por arquivo; `upsertMany` em `tx`; advisory lock evita duas ingestões | ✅ presente | `TituloAPagarRepository.ts:~88-135` |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | `pg_try_advisory_lock` (nunca bloqueia); prazo evita crescimento ilimitado; sequencial por causa do cap de sessões | ✅ presente | `PostgreeDatabaseClient.ts:210-231`; ADR-0067 |
| Increase Competence Set | Falha parcial devolve resultado detalhado (novos/relidos/boletos/falhas/adiados) em vez de erro opaco | ✅ presente | `SispagInterface.ts` (`DdaNaIngestao`) |

## 4. Findings (achados)

### F-availability-1: prazo de 60 s não é teto rígido da fase DDA

- **Severidade**: P2
- **Tactic violada**: Exception Prevention (limitação de tempo)
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:121-141`, `IngestaoPagamentosService.ts:~203-206`
- **Evidência (objetiva)**:
  ```
  if (limite !== undefined && Date.now() > limite) return null;   // checado só ao iniciar cada arquivo
  const itens = await this.dda.listarItens(...)                    // em voo: sem corte
  ```
  `listarArquivos` roda antes do `limite` ser consultado; FANOUT_LIMIT = 3; timeout do cliente 40 s por chamada (`services/conexos.ts:121`) com retry em `ConexosDdaClient.ts:119`.
- **Impacto técnico**: o "orçamento de 60 s" pode ser excedido por listagem lenta ou por 3 arquivos em voo paginados; a ingestão (e o lock `PAGAMENTO_INGEST_LOCK_KEY`, e a conexão do pool) fica retida mais que o planejado. Quem abre a tela pode esperar mais que o esperado.
- **Impacto de negócio**: o analista pode ver a carteira mais lenta que os ~10 s habituais; não há perda de dado nem escrita duplicada (fase só lê e salva pool).
- **Métrica de baseline**: prazo 60 s vs ingestão ~10 s medidos; pior caso não medido em produção (⚠️ não medível localmente). Sem número de produção, rebaixado a P2.

### F-availability-2: sem memória de falhas consecutivas da fase DDA (sem Removal from Service)

- **Severidade**: P2
- **Tactic violada**: Removal from Service / Condition Monitoring
- **Localização**: `IngestaoPagamentosService.ts:~196-222`
- **Evidência (objetiva)**: toda ingestão (3 crons/dia + aberturas de tela a cada 30 min + botão) tenta o DDA do zero, mesmo que a última run tenha terminado `falhou`. O cooldown existente em `CarteiraAtualizacaoService` considera falha da ingestão inteira, não da fase DDA (ela nunca falha a run).
- **Impacto técnico**: DDA fora do ar consome até 60 s + retries em cada ingestão e disputa o cap de sessões do robô com a leitura de títulos que vem a seguir (ADR-0066 §3).
- **Impacto de negócio**: ingestão mais lenta durante a indisponibilidade; o aviso na run é por rodada, sem tendência.
- **Métrica de baseline**: 0 contadores de falha consecutiva do DDA no delta; frequência de gatilhos ≥ 3 crons + aberturas (TTL 30 min).

### F-availability-3: ocupada é silenciosa e sem aviso mesmo se o outro sync estiver preso

- **Severidade**: P3
- **Tactic violada**: Monitor / Heartbeat
- **Localização**: `IngestaoPagamentosService.ts:~216`, `avisoDaRun` (`ocupada` não é aviso)
- **Evidência (objetiva)**: `if (error instanceof IngestLockBusyError) return { estado: OCUPADA }` sem log; `ddaComAviso` exclui `OCUPADA`.
- **Impacto técnico**: um sync manual sem prazo (botão/job avulso) que fique pendurado faz toda ingestão seguinte reportar `ocupada` sem log; só o alerta de pool > 8 h na aba denuncia.
- **Impacto de negócio**: defasagem do DDA detectada com atraso de até 8 h em dia útil; boleto falso "sem DDA" em carteira.
- **Métrica de baseline**: limiar atual de defasagem 8 h (`ddaDefasado.ts`); log de `ocupada` = 0.

### F-availability-4: ausência de métrica de duração/estado da fase DDA para detecção de regressão

- **Severidade**: P3
- **Tactic violada**: Monitor
- **Localização**: `IngestaoPagamentosService.ts:196-222`, `ingest-pagamentos.ts:30-45`
- **Evidência (objetiva)**: o estado e as contagens aparecem no resultado/saída do job, mas não há duração da fase DDA nem agregação por run persistida (só `error_message` em texto).
- **Impacto técnico**: não dá para provar o orçamento de 60 s nem a taxa de `parcial/falhou` sem coletar logs.
- **Impacto de negócio**: o investimento nesta mudança não é defensável com número real.
- **Métrica de baseline**: 0 campos estruturados de duração da fase DDA.

## 5. Cards Kanban

### [availability-1] Limitar rigidamente a fase DDA ao prazo da ingestão

- **Problema**
  > O prazo de 60 s só é verificado no início de cada arquivo; `listarArquivos` e até 3 arquivos em voo (timeout 40 s por chamada, com retry) podem estourar o orçamento enquanto a ingestão segura o lock e a conexão. Pior caso não medido em produção.

- **Melhoria Proposta**
  > Aplicar `Promise.race` com o orçamento restante (ou `AbortSignal.timeout`) em torno de `listarArquivos` e `listarItens` em `BoletoDdaService.executarSincronizacao`, contando o arquivo interrompido como `arquivosAdiados`. Tactic: Exception Prevention. Mover `DDA_PRAZO_NA_INGESTAO_MS` para `EnvironmentProvider` com default 60 000.

- **Resultado Esperado**
  > Fase DDA nunca excede prazo + margem fixa (ex.: 65 s). Hoje: teto implícito não medido → alvo: ≤ 65 s verificado por teste com client que nunca resolve.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Duração máxima da fase DDA em teste com dependência pendurada: não limitada → ≤ prazo + 5 s
- **Risco de não fazer**: Um `fin124` lento transforma cada abertura de tela em espera longa e segura a conexão do pool e o lock da ingestão.
- **Dependências**: nenhuma

### [availability-2] Registrar duração e estado da fase DDA e alertar tendência

- **Problema**
  > O estado `parcial/falhou/ocupada` vive só em `error_message` e no stdout do job; não há duração nem contagem agregada. Não é possível defender o orçamento de 60 s nem detectar degradação gradual.

- **Melhoria Proposta**
  > Incluir `duracaoMs` em `DdaNaIngestao` e no log `business_info`; logar `ocupada` em nível INFO; persistir `dda_estado` na run (coluna nullable). Tactic: Monitor. Avisar quando o estado for não-`sincronizado` em N runs consecutivas.

- **Resultado Esperado**
  > Percentual de runs por estado e p95 da fase DDA consultáveis. Hoje: 0 campos estruturados → alvo: 100% das runs com estado + duração.

- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3, F-availability-4
- **Métricas de sucesso**:
  - Runs com `dda_estado` e duração registrados: 0% → 100%
- **Risco de não fazer**: A defasagem do pool só aparece quando o analista vê "boleto sem DDA" falso.
- **Dependências**: migration aditiva simples

### [availability-3] Pular a fase DDA após falhas consecutivas (circuit breaker leve)

- **Problema**
  > Cada ingestão retenta o DDA do zero mesmo com `fin124` fora do ar, gastando até 60 s e sessões do robô que a leitura de títulos precisa a seguir.

- **Melhoria Proposta**
  > Ler as últimas K runs (`dda_estado`) e, se todas `falhou`, usar prazo curto (ex.: 10 s) ou pular a fase por um cooldown, mantendo o aviso. Tactic: Removal from Service.

- **Resultado Esperado**
  > Durante indisponibilidade do DDA a ingestão volta ao tempo base (~10 s). Hoje: até 60 s por run → alvo: ≤ 15 s quando houver K falhas consecutivas.

- **Tactic alvo**: Removal from Service
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Duração da ingestão com DDA fora do ar: ≤ 70 s (teórico) → ≤ 15 s
- **Risco de não fazer**: Incidente prolongado do DDA degrada toda abertura de tela da carteira SISPAG.
- **Dependências**: availability-2 (persistir estado por run)

## 6. Notas do agente

- Escopo restrito ao delta; `infra/` não existe, então DLQ/alarmes CloudWatch/shared_account_id não se aplicam (marcado N/A/não medível).
- Verificado que `LogService.warn` só escreve em stdout (`LogService.ts:26`), logo `avisar` dentro do `catch` não pode derrubar a ingestão.
- O `catch` externo de `runIngestion` marca a run `error` para falhas não-DDA, comportamento preexistente e correto.
- Cross-QA: F-availability-1 e availability-1 têm relação com performance (orçamento de latência da abertura de tela).
