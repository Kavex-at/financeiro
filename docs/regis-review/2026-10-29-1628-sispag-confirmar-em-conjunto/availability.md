---
qa: Availability
qa_slug: availability
run_id: 2026-10-29-1628-sispag-confirmar-em-conjunto
agent: qa-availability
generated_at: 2026-10-29T16:28:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista do SISPAG dispara "confirmar em conjunto" (até 30 irmãos) na gaveta do título | Uma das linhas sofre falta de resposta/erro intermitente do Conexos ou um lote irmão foi finalizado entre o `listarIrmaos` e o `confirmar-em-conjunto` | `ConfirmacaoEmConjuntoService` → `BoletoSuggestionService.confirmar` (loop sequencial por linha) + `AjusteCentavosTituloService.agendarEmSequencia` (fila em background) | Produção Express/Render (hoje), uso diurno pela analista, Conexos acessível, cache de desfechos aquecido | Linhas confirmáveis seguem; linha problemática volta como `RECUSADA` + motivo pt-BR; teto duro em 30 linhas; replay produz `JA_CONFIRMADA` por idempotência; nunca "tudo-ou-nada"; ajuste de centavos converge via `retomarPendentes` | 0 linhas perdidas em replay (idempotente), 0 confirmações duplicadas, batch de 30 em ≤ 1,5 s sob cenário compartilhado (medido: 1,3 s), stop-gap em 422 acima de 30 — e nenhuma linha pode travar o batch indefinidamente |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotência de replay (30 linhas repetidas) | 30 `JA_CONFIRMADA` (0 duplicadas) | 100% dedup | ✅ | Live measurement (shared metrics); `ConfirmacaoEmConjuntoService.confirmarLinha` branch `!r.criada` |
| Teto duro de linhas por chamada | 30; 31 → HTTP 422 nada confirmado | ≥ 1 corte explícito | ✅ | `BatchConfirmationTooLargeError.ts:4-19`; shared metrics "31 rows = 422" |
| Dedup pré-loop no payload | `new Map(itens.map(i => [chaveDaLinha(i), i]))` | dedup antes do fan-out | ✅ | `ConfirmacaoEmConjuntoService.ts:88` |
| Sanity Checking de transição (lote finalizado) | Releitura ao vivo por linha, recusa com motivo | 100% das linhas | ✅ | `ConfirmacaoEmConjuntoService.ts:155-166` |
| Timeout explícito no `confirmar` por linha | ausente (sem `AbortController`/`timeout`) | ≤ 5 s por linha | ❌ | `grep -n timeout src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts src/backend/domain/service/sispag/BoletoSuggestionService.ts` → 0 hits |
| Timeout do Conexos no fluxo da feature | herdado do `ConexosClient` (não configurado) | explícito | ❌ | `grep -n timeout src/backend/domain/client/ConexosClient.ts` → 0 hits |
| Durabilidade do ajuste de centavos pós-batch | fire-and-forget (`void this.executarEmSequencia(...)`) + `retomarPendentes({filCod})` ao final | 100% convergência mesmo se o processo cair no meio | ⚠️ | `AjusteCentavosTituloService.ts:313,341-350` |
| Exception Handling por linha | `try/catch` → `RECUSADA` com `userMessage`, 5xx logado | 100% das linhas protegidas | ✅ | `ConfirmacaoEmConjuntoService.ts:168-186` |
| Transactions (atômica por linha) | sim, via `BoletoSuggestionService.confirmar` em `tx` existente | 100% das confirmações | ✅ | `BoletoSuggestionService.ts:460-490` (bloco `tx`) |
| Blast radius multi-tenant | n/a — Express/Render + Supabase hoje; sem conta AWS por cliente | 0 referências cruzadas | N/A | CLAUDE.md "Infra: — não existe" |
| Alarme CloudWatch para falhas em cascata do batch | não existe pipeline AWS | ≥ 1 alarme crítico | N/A | sem `infra/` |
| Throughput do batch (30 linhas, cenário compartilhado) | 1,3 s | ≤ 1,5 s | ✅ | shared metrics (D9) |
| Throughput sem cenário compartilhado (regressão) | 36,5 s | ≤ 2 s | ✅ (mitigado pela emenda 2026-10-29 da ADR-0080) | shared metrics |

> ⚠️ **Não medível localmente**: MTTR de uma linha travada por Conexos pendurado. Requer CloudWatch Logs Insights (que não existe) OU, no runtime atual (Express/Render), uma métrica derivada do log `confirmação em conjunto concluída` com `duracao_total_ms` por `conjuntoId`. Recomendação: instrumentar duração por linha e por conjunto; alertar P95 > 5 s por linha.

> ⚠️ **Não medível localmente**: taxa de convergência do `retomarPendentes` após queda do processo durante `executarEmSequencia`. Requer injetar falha e observar reconciliação em ambiente de HML.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não aplicado nesta feature (sem health-check próprio) | N/A | — |
| Heartbeat | N/A — batch é síncrono curto, sem worker contínuo | N/A | — |
| Monitor | `LogService` em cada linha + log final do conjunto com `pedidas/confirmadas/novas/recusadas` | ⚠️ parcial | `ConfirmacaoEmConjuntoService.ts:131-146`; falta métrica agregada (duração, taxa de recusa) |
| Timestamp | `conjuntoId` (UUID) + `tituloOrigem` propagados ao detalhe da decisão | ✅ presente | `BoletoSuggestionService.ts:1286-1294` (`detalheDoConjunto`) |
| Sanity Checking | Releitura ao vivo de título/boleto/lote por linha; recusa se lote virou finalizado ou se filial diverge | ✅ presente | `ConfirmacaoEmConjuntoService.ts:144-166`; `exigirElegivelNoConjunto` em `BoletoSuggestionService.ts:1254-1270` |
| Condition Monitoring | `retomarPendentes({filCod})` após o loop reconcilia pendentes antigos | ✅ presente | `AjusteCentavosTituloService.ts:341-350` |
| Voting | N/A — sem réplicas | N/A | — |
| Exception Detection | `isHandlerError(err) && err.statusCode < 500` separa recusa de usuário vs 5xx inesperado | ✅ presente | `ConfirmacaoEmConjuntoService.ts:174-186` |
| Self-Test | Ausente para o endpoint batch | ❌ ausente | — |
| Active Redundancy | N/A | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Cada linha num `try/catch` que materializa `RECUSADA` + motivo; não aborta o batch | ✅ presente | `ConfirmacaoEmConjuntoService.ts:168-187` |
| Rollback | Transação por linha no `confirmar` existente; batch não precisa de rollback global (projeto: "nunca tudo-ou-nada") | ✅ presente (por decisão) | ADR-0080 I15t(4); `BoletoSuggestionService.ts:460-490` |
| Software Upgrade | N/A | N/A | — |
| Retry | Não há `RetryExecutor` ao redor do `confirmar` por linha; a tela é quem decide se reempurra o conjunto | ❌ ausente | `grep RetryExecutor src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts` → 0 |
| Ignore Faulty Behavior | A linha com falha 5xx não derruba o batch (mensagem genérica + log `BUSINESS_WARN`) | ✅ presente | `ConfirmacaoEmConjuntoService.ts:178-186` |
| Degradation | Resposta por linha garante que o lote parcial é entregue mesmo com N recusas; o ajuste de centavos cai para a fila sequencial | ✅ presente | `ConfirmacaoEmConjuntoService.ts:119-129`; `AjusteCentavosTituloService.ts:311-315` |
| Reconfiguration | N/A | N/A | — |
| Shadow | N/A | N/A | — |
| State Resynchronization | `retomarPendentes` por filial no fim do batch reconvergeajustes | ✅ presente | `AjusteCentavosTituloService.ts:341-350` |
| Escalating Restart | N/A — Express/Render single-process | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | N/A | N/A | — |
| Transactions | Idempotência via dedup de chave + estado `JA_CONFIRMADA`; cada linha num tx do Postgres | ✅ presente | `ConfirmacaoEmConjuntoService.ts:88`; `BoletoSuggestionService.ts:179-200` (branch `JA_CONFIRMADA`) |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | Teto duro em 30 (422 antes de qualquer escrita); filial diferente é RECUSADA antes do `confirmar`; cenário único por batch evita N recálculos | ✅ presente | `BatchConfirmationTooLargeError.ts`; `ConfirmacaoEmConjuntoService.ts:89-96,140-143` |
| Increase Competence Set | Mensagens de recusa em pt-BR explicando o motivo guiam a analista para o caminho individual | ✅ presente | `ConfirmacaoEmConjuntoService.ts:141,156,162,174` |

## 4. Findings (achados)

### F-availability-1: Loop sequencial sem timeout por linha — um Conexos pendurado trava o batch inteiro

- **Severidade**: P1
- **Tactic violada**: Exception Prevention / Retry (bounded time)
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:117-129` (laço `for (const item of itens)`); `src/backend/domain/service/sispag/BoletoSuggestionService.ts` (nenhum `AbortController`/`timeout` ao chamar o cliente).
- **Evidência (objetiva)**:
  ```
  for (const item of itens) {
      const r = await this.confirmarLinha(item, input.ator, conjunto, cenario);
      ...
  }
  ```
  `grep -n timeout src/backend/domain/service/sispag/{ConfirmacaoEmConjuntoService,BoletoSuggestionService}.ts src/backend/domain/client/ConexosClient.ts` → 0 hits.
- **Impacto técnico**: num batch de 30, uma única chamada pendurada no Conexos (sem timeout no `ConexosClient`) pode consumir até o teto do request Express (default 2 min no Render, 15 min em Lambda alvo) e segurar as 29 linhas restantes sequencialmente. A analista não vê nenhuma linha confirmada até o timeout do front-end.
- **Impacto de negócio**: janela de corte SISPAG (D0/D+1) estreita; um batch travado às 17h30 pode fazer a analista perder a janela do banco em 15 minutos e empurrar pagamentos para o próximo dia útil.
- **Métrica de baseline**: throughput medido 1,3 s / 30 linhas (cenário compartilhado), ou seja ~43 ms/linha. Qualquer linha acima de ~5 s já é 100× o P50 observado. Sem timeout, o teto superior é o do request HTTP (120 s em Render, 900 s em Lambda alvo) — fator 2.800×–20.000× o P50.

### F-availability-2: `agendarEmSequencia` é fire-and-forget com `void` — ajustes podem ser perdidos se o processo cair durante o batch

- **Severidade**: P2
- **Tactic violada**: State Resynchronization (durabilidade da intenção)
- **Localização**: `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:313` (`void this.executarEmSequencia(pedidos)`); chamador em `ConfirmacaoEmConjuntoService.ts:128`.
- **Evidência (objetiva)**:
  ```
  public agendarEmSequencia = (pedidos: ...): void => {
      if (pedidos.length === 0) return;
      void this.executarEmSequencia(pedidos);
  };
  ```
  A fila de ajustes vive só na promise em memória; o HTTP response volta antes dela terminar. Mitigação atual: `retomarPendentes({filCod})` dentro da própria fila reconcilia pendentes antigos quando a tela/servidor sobe.
- **Impacto técnico**: se o processo Express for reiniciado por deploy, OOM ou SIGTERM da plataforma entre a resposta HTTP e o fim da fila, até 30 ajustes podem ficar pendentes sem retomada imediata — só convergindo no próximo `abrirSispag` (que roda a varredura). No alvo Lambda isso é pior: a função termina ao devolver a resposta e a promise `void` é descartada.
- **Impacto de negócio**: o estado de "centavos ajustados" fica atrasado até o próximo acesso à tela; não há perda contábil (a varredura cura), mas há incoerência visual temporária e, no alvo Lambda, a varredura só roda quando alguém abre a tela.
- **Métrica de baseline**: 100% dos ajustes pós-batch dependem de uma promise não-awaitada; 0% têm persistência própria antes do `fin070` ser chamado (as pendências ficam no estado da decisão, não numa fila durável). Varredura só é acionada por `agendarAposAbrirSispag` (não por EventBridge).

### F-availability-3: Sem alarme/métrica agregada para o endpoint batch

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:131-146` (log do conjunto); sem `duracao_total_ms`, sem `duracao_max_linha_ms`, sem contagem por `motivo` de recusa.
- **Evidência (objetiva)**:
  ```
  await this.logService.info({
      type: LOG_TYPE.BUSINESS_INFO,
      message: 'confirmação em conjunto concluída',
      data: { conjuntoId, origem, pesCod, pedidas, confirmadas, novas, recusadas, ator },
  });
  ```
  Nenhum campo numérico de tempo; distribuição de motivos não é agregável.
- **Impacto técnico**: inviável detectar P95 de duração ou spike de recusa por "lote finalizado" (sintoma de concorrência com outra analista) sem reler log cru. Em incidente, triagem é manual.
- **Impacto de negócio**: MTTR estimado alto; a Kavex só sabe que o batch degradou quando a analista reclama.
- **Métrica de baseline**: 0 campos de duração emitidos; 1 incidente simulado hoje exige leitura de ~N linhas de log para reconstruir a timeline do `conjuntoId`.

### F-availability-4: Mensagem genérica de recusa pode mascarar bug sistêmico silencioso

- **Severidade**: P3
- **Tactic violada**: Exception Detection
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:19` (`MOTIVO_INESPERADO = 'Não foi possível confirmar este título agora. Tente de novo.'`) + branch de 5xx em `confirmarLinha`.
- **Evidência (objetiva)**:
  ```
  const MOTIVO_INESPERADO = 'Não foi possível confirmar este título agora. Tente de novo.';
  ...
  if (isHandlerError(err) && err.statusCode < 500) return recusa(err.userMessage);
  await this.logService.error(...)
  return recusa(MOTIVO_INESPERADO);
  ```
- **Impacto técnico**: todas as 5xx viram "tente de novo", e o log é `BUSINESS_WARN` (não `BUSINESS_ERROR`). Se 30 linhas falharem por um bug de código (ex.: regressão no `cenario`), a tela mostra 30× o mesmo motivo e os logs ficam como warn — sem alerta.
- **Impacto de negócio**: janela do batch perdida sem alarme; a Kavex descobre pelo chamado da analista.
- **Métrica de baseline**: 1 código de severidade para N causas distintas; `BUSINESS_WARN` não dispara alerta hoje (vs `BUSINESS_ERROR`).

## 5. Cards Kanban

### [availability-1] Impor timeout por linha e fail-fast no `ConexosClient` dentro do batch

- **Problema**
  > Hoje, uma única linha com Conexos pendurado trava o batch inteiro em laço sequencial sem corte temporal: até 120 s (Render) ou 900 s (Lambda alvo) por linha, contra P50 medido de ~43 ms. O analista perde a janela do SISPAG do dia sem ver nenhuma confirmação parcial.

- **Melhoria Proposta**
  > Aplicar **Exception Prevention** envolvendo cada iteração do `for` em `ConfirmacaoEmConjuntoService.confirmarLinha` com um timeout dedicado (via `AbortController` ou `Promise.race` com budget configurável — 5 s default). Em paralelo, injetar `timeout` explícito no `ConexosClient` para o endpoint usado pelo `confirmar`. Expor o budget via `EnvironmentProvider` (`SISPAG_BATCH_LINE_TIMEOUT_MS`).

- **Resultado Esperado**
  > Nenhuma linha pode consumir mais que o budget; vencido o timeout, a linha vira `RECUSADA` com motivo "O Conexos não respondeu a tempo; confirme-o sozinho" e o batch segue. Tempo máximo de batch de 30 linhas: 150 s no pior caso (atualmente ilimitado).

- **Tactic alvo**: Exception Prevention + Retry (bounded)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - P95 de duração por linha: desconhecido → ≤ 500 ms
  - Teto superior por batch: 120 s (Render) → ≤ 30 × budget (ex.: 150 s)
  - % de linhas que extrapolam budget: n/d → métrica exposta no log final do conjunto
- **Risco de não fazer**: um incidente no Conexos no horário de corte do SISPAG trava todos os batches ativos de todas as analistas e pode fazer a Columbia perder a janela do banco; o `fin070` tem histórico de latência irregular (ADR-0074, incidentes documentados).
- **Dependências**: nenhuma.

### [availability-2] Durabilidade da fila de ajuste de centavos pós-batch

- **Problema**
  > `agendarEmSequencia` dispara `void this.executarEmSequencia(...)`: a promise não é awaitada e vive só em memória. Se o processo cair (deploy, SIGTERM, OOM) entre a resposta HTTP e o fim da fila, até 30 ajustes ficam pendurados até alguém reabrir a tela e disparar `retomarPendentes`. No alvo Lambda, a função termina ao retornar e a promise é descartada.

- **Melhoria Proposta**
  > Aplicar **State Resynchronization** com durabilidade mínima: ou (a) persistir a intenção de ajuste no DB antes do `void` (uma linha por pedido com `status=PENDING`) e consumir via job agendado — já há `jobs/` para padrão —, ou (b) acionar `retomarPendentes` como primeira coisa no boot do servidor (`ServerProcessMarker`), não só na abertura da tela. Opção (a) é a defendida pela ADR-0074 (fin070 renegocia escritas reais).

- **Resultado Esperado**
  > Convergência garantida independentemente de queda do processo; MTTR de ajuste pendente ≤ 1 minuto após restart (vs "até a próxima abertura da tela").

- **Tactic alvo**: State Resynchronization
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Ajustes pendentes pós-restart: dependem da abertura da tela → ≤ 60 s
  - Promessas `void` no caminho crítico: 1 → 0
- **Risco de não fazer**: no corte para o alvo Lambda (roadmap), a feature regride silenciosamente: ajustes de centavos de batches confirmados antes do fim da execução Lambda deixam de rodar.
- **Dependências**: alinhamento com a dívida descrita no ADR-0074 (kill-switch `SISPAG_LIVE_WRITE_ENABLED`).

### [availability-3] Instrumentar duração e taxa de recusa por `conjuntoId`

- **Problema**
  > O log final emite apenas contadores (`pedidas`, `confirmadas`, `recusadas`), sem tempo total nem distribuição de motivos. Falhas 5xx são logadas como `BUSINESS_WARN` com mensagem genérica, impossibilitando alerta automático. Em incidente, triagem é por leitura manual de log.

- **Melhoria Proposta**
  > Aplicar **Monitor** acrescentando `duracao_total_ms`, `duracao_max_linha_ms`, `motivos: Record<string, number>` no log `confirmação em conjunto concluída` e promover a severidade do catch 5xx para `BUSINESS_ERROR` com `conjuntoId`. Em paralelo, derivar uma métrica agregada (dashboard simples do servidor atual; CloudWatch Metric Filter no alvo).

- **Resultado Esperado**
  > Dashboard mostra P95 e taxa de recusa por motivo em janela deslizante; alerta automático em `BUSINESS_ERROR` 5xx em caminho batch. MTTR percebido cai de "quando a analista reclama" para ≤ 15 min.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3, F-availability-4
- **Métricas de sucesso**:
  - Campos de duração emitidos: 0 → 2 (`duracao_total_ms`, `duracao_max_linha_ms`)
  - Taxa de severidade 5xx promovida: `BUSINESS_WARN` → `BUSINESS_ERROR` com `conjuntoId`
- **Risco de não fazer**: regressão de desempenho (ex.: cenário compartilhado quebrado — já aconteceu em dev, ver shared metrics 36,5 s vs 1,3 s) passa despercebida até o primeiro batch grande em produção.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao diff da feature: pré-existentes (ex.: ausência de timeout no `ConexosClient` em geral) só foram levantados onde este diff os amplifica (loop sequencial de 30 linhas).
- Métricas de infra AWS (DLQ, alarme CloudWatch, blast radius multi-tenant) marcadas N/A — o repo roda em Express/Render hoje, sem `infra/`.
- Cross-QA: F-availability-1 toca Performance (budget de latência) e F-availability-3 toca Testability/Observability — sinalizando ao `qa-consolidator`.
- Baseline numéricos de P1/P2 ancorados em medições do shared-metrics (1,3 s / 30 linhas, 36,5 s regressão, 30 JA_CONFIRMADA, 31 → 422).
