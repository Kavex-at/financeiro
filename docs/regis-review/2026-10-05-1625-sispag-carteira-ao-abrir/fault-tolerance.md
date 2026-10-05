---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-05-1625
agent: qa-fault-tolerance
generated_at: 2026-10-05T16:40:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo `/sispag` (vários em paralelo) ou cron | Carteira gravada com mais de 30 min; ingestão falha, processo morre no meio, ou aba é fechada durante o refresh | `CarteiraAtualizacaoService`, `IngestaoPagamentosService`, `useCarteiraAoAbrir` | Express/Render, Conexos com sessões limitadas, ingestão síncrona de ~9 s | No máximo uma ingestão por vez; falha vira cooldown; run morta não bloqueia; carteira nunca fica pior que a anterior; sem escrita no ERP | 0 ingestões concorrentes; 0 escritas no Conexos; run presa liberada em ≤10 min; fechar a aba não corrompe estado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ordem de decisão TTL → running → cooldown → run | 4 passos, na ordem esperada | ordem fixa e testada | ✅ | `CarteiraAtualizacaoService.ts:78-98` |
| Run `running` morta (>10 min) | ignorada, cai para nova tentativa; o advisory lock decide | não bloquear para sempre | ✅ | `CarteiraAtualizacaoService.ts:13,83` |
| Contenção de lock mapeada | `IngestLockBusyError` → `em_andamento` (não 409) | sim | ✅ | `CarteiraAtualizacaoService.ts:108` |
| Liberação do lock se o processo morre | lock de sessão em client dedicado; conexão cai, Postgres libera | sim | ✅ | `PostgreeDatabaseClient.ts:210-232` |
| Escritas no ERP no delta | 0 (só lê Conexos, escreve no Postgres) | 0 | ✅ | `routes/sispag.ts` (rota nova), I1 |
| Escritas da ingestão em transação única (`upsertMany` + `marcarInativosForaDaRun` + `finishRun`) | 0 de 3 em transação | 1 transação ou convergência garantida | ⚠️ | `IngestaoPagamentosService.ts:218-236` |
| Leitura parcial (filial falha) conta como `success` para o TTL | sim: 1 run `success` com `errorMessage` | retentar filiais faltantes | ⚠️ | `IngestaoPagamentosService.ts:234-250`, `PagamentoIngestaoRunRepository.ts:87-93` |
| Reentrada do hook em StrictMode ou aba fechada | `vivo=false` aborta; backend absorve por TTL e lock | idempotente | ✅ | `useCarteiraAoAbrir.ts:37-75` |
| Tentativas do hook com outra ingestão rodando | 6 × 8 s = 48 s, ingestão leva ~9 s | cobrir ≥3× a duração | ✅ | `useCarteiraAoAbrir.ts:7-9` |
| Testes do service e do hook | 151 + 72 linhas; backend 198 suítes / 3644 testes passam | verdes | ✅ | `_shared-metrics.md` |
| Reaper de run presa (`running` eterna) | ⚠️ **Não medível localmente** no delta; o cron do reaper rodou a cada ~3–6 h em vez de 15 min | confirmar em produção | ⚠️ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Lê o último `success` e a última run antes de decidir | ✅ presente | `CarteiraAtualizacaoService.ts:70,82` |
| Timestamp | Idade do último sucesso, `startedAt`, `finishedAt` comparados com TTL, 10 min e cooldown | ✅ presente | `CarteiraAtualizacaoService.ts:74-89` |
| Timeout | Run `running` com mais de 10 min deixa de bloquear; o hook desiste em ~48 s | ✅ presente | `:13`, `useCarteiraAoAbrir.ts:9` |
| Condition Monitoring | `pagamento_ingestao_run` audita cada ingestão com `triggeredBy=abertura:<ator>` | ✅ presente | `routes/sispag.ts` (nova rota) |
| Comparison | Anti-fantasma por filial lida | ✅ presente | `IngestaoPagamentosService.ts:218` |
| Redundancy | Cron 3×/dia em dias úteis e refresh na abertura | ⚠️ parcial | `ingest-sispag.yml` |
| Recovery (forward) | Próxima ingestão converge (upsert idempotente) | ✅ presente | `IngestaoPagamentosService.ts:218` |
| Reintroduction (Escalating Restart) | Cooldown de 5 min após `error`; falha vira `falha_recente` | ✅ presente | `CarteiraAtualizacaoService.ts:86-96` |
| Idempotent Replay | Duas aberturas simultâneas: o lock serializa, a segunda vê `fresca` ou `em_andamento` | ✅ presente | `:108` |
| Rollback / Compensating Transaction | N/A: sem escrita externa; o estado local converge na próxima run | N/A | I1 |
| Repair State / Reconcile | Reaper e anti-fantasma; fechamento de run presa depende do reaper | ⚠️ parcial | F-ft-2 |
| Quarantine | Falha recente exposta ao usuário com `motivo` | ✅ presente | `CarteiraAtualizacaoService.ts:91-95` |
| Substitution / Replacement / Predictive Model / Increase Competence Set / Self-Test / Voting | N/A: fora do escopo do delta | N/A | Delta só orquestra a ingestão existente |

## 4. Findings

### F-ft-1: Leitura parcial vira `success` e a tela fica "fresca" por 30 min sem as filiais faltantes

- **Severidade**: P2
- **Tactic violada**: Reintroduction (State Resync)
- **Localização**: `src/backend/domain/service/sispag/IngestaoPagamentosService.ts:234-250`; `src/backend/domain/repository/sispag/PagamentoIngestaoRunRepository.ts:87-93`; `CarteiraAtualizacaoService.ts:78`
- **Evidência (objetiva)**:
  ```
  status = 'success' ... errorMessage: 'filiais não lidas: filial N: ...'
  findLatestSuccessFinishedAt: WHERE status = 'success'
  ```
- **Impacto técnico**: Se 1 de 7 filiais falha, a run é `success`, o TTL de 30 min a trata como fresca e nenhuma abertura tenta de novo. Os títulos antigas dessa filial ficam preservados (o anti-fantasma só atua nas lidas), então a carteira fica defasada, não corrompida.
- **Impacto de negócio**: o analista vê a carteira como "recém-atualizada" enquanto uma filial está até 30 min (ou mais, se o cron atrasar 2–5 h) atrás.
- **Métrica de baseline**: 1 de 7 filiais ausentes = 14% da carteira defasada por até 30 min; 0 sinalização no estado `fresca` (o resultado `filiaisComFalha` só existe em `atualizada`).

### F-ft-2: Run `running` morta só é fechada pelo reaper; este rodou a cada ~3–6 h

- **Severidade**: P2
- **Tactic violada**: Repair State
- **Localização**: `CarteiraAtualizacaoService.ts:83`; `IngestaoPagamentosService.ts:169-290`
- **Evidência (objetiva)**:
  ```
  if (ultima?.status === 'running' && agora - Date.parse(ultima.startedAt) < RUN_PRESA_MS) → em_andamento
  ```
  Reaper "pedido a cada 15 min, rodou a cada ~3–6 h" (`_shared-metrics.md`).
- **Impacto técnico**: A decisão do delta não fica presa: após 10 min uma run morta é ignorada e o lock real decide. A linha `running` continua no banco e polui o histórico e a "última run" de outras telas. Se o `finishRun` do catch (`:282`) também falhar, a run fica `running` para sempre.
- **Impacto de negócio**: histórico de ingestão mostra execuções fantasmas; baixo risco financeiro.
- **Métrica de baseline**: janela de limpeza de 3–6 h contra a meta de 15 min.

### F-ft-3: Gravação da ingestão sem transação única, janela entre upsert e anti-fantasma

- **Severidade**: P2
- **Tactic violada**: Rollback
- **Localização**: `IngestaoPagamentosService.ts:218-219` (`upsertMany`, depois `marcarInativosForaDaRun`)
- **Evidência (objetiva)**: duas chamadas sequenciais de repositório, sem `transaction()`. Grep de `transaction` em `TituloAPagarRepository.ts`: 0 ocorrências.
- **Impacto técnico**: Uma morte de processo entre as duas deixa títulos novos gravados e fantasmas ainda ativos; a próxima ingestão converge. Antes da mudança só o cron/botão disparavam isso; agora cada abertura de tela é um gatilho, então a janela é exposta mais vezes. O trabalho de 9 s com a aba fechada continua no servidor (o hook só aborta o cliente), o que é correto.
- **Impacto de negócio**: no pior caso, um título pago continua visível por até 1 ciclo; sem dano financeiro, porque a formação de lote não roda na abertura (ADR-0060 decisão 4).
- **Métrica de baseline**: 0 de 2 escritas de carteira em transação; janela de exposição ~ms por ingestão.

### F-ft-4: `em_andamento` sem teto cria polling de até 48 s por aba

- **Severidade**: P3
- **Tactic violada**: Timeout
- **Localização**: `useCarteiraAoAbrir.ts:42-59`
- **Evidência (objetiva)**: após 6 tentativas em `em_andamento` o laço sai para `ocioso` sem aviso (`:64`); o usuário vê dados antigos como se a atualização tivesse terminado.
- **Impacto técnico**: com um lock preso por run viva e lenta (>48 s) a tela fica silenciosamente defasada.
- **Impacto de negócio**: baixo; a ingestão leva ~9 s.
- **Métrica de baseline**: 6 × 8 s = 48 s de teto contra ~9 s de duração normal (margem 5×).

## 5. Cards Kanban

### [ft-1] Retentar filiais não lidas em vez de tratar leitura parcial como fresca

- **Problema**
  > Leitura parcial grava `success` e fixa a carteira como fresca por 30 min (`IngestaoPagamentosService.ts:234`). A filial ausente só reaparece na próxima janela do TTL ou do cron (atrasos de 2–5 h).

- **Melhoria Proposta**
  > Em `findLatestSuccessFinishedAt` ou no service, tratar run com `errorMessage` de filiais não lidas como candidata a retry sob o cooldown; ou devolver `filiaisComFalha` também no estado `fresca` para o frontend avisar. Tactic: State Resync.

- **Resultado Esperado**
  > Filial não lida retentada em ≤5 min (cooldown) em vez de ≤30 min; o aviso aparece na tela.

- **Tactic alvo**: Reintroduction (State Resync)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-1, F-ft-4
- **Métricas de sucesso**:
  - Janela de defasagem por filial parcial: 30 min → 5 min
  - Telas com aviso de leitura parcial: 0 → 1
- **Risco de não fazer**: o analista decide pagamento sobre carteira incompleta sem saber.
- **Dependências**: nenhuma.

### [ft-2] Fechar runs `running` mortas no próprio service ou apertar o reaper

- **Problema**
  > Runs mortas dependem de um reaper que roda a cada 3–6 h contra os 15 min pedidos. O service ignora a run velha, mas não a fecha.

- **Melhoria Proposta**
  > Ao decidir (`CarteiraAtualizacaoService.ts:83`), marcar como `error` a run `running` com mais de 10 min antes de rodar, ou criar `finishStaleRuns` no `PagamentoIngestaoRunRepository`. Tactic: Repair State.

- **Resultado Esperado**
  > Runs `running` com mais de 10 min no histórico: até 6 h → 0 após a próxima abertura.

- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-2
- **Métricas de sucesso**:
  - Idade máxima de run `running` visível: 3–6 h → ≤10 min
- **Risco de não fazer**: o histórico cresce com fantasmas e mascara falhas reais.
- **Dependências**: nenhuma.

### [ft-3] Embrulhar upsert, anti-fantasma e fechamento da run em uma transação

- **Problema**
  > Cada abertura de tela agora pode disparar a ingestão, e `upsertMany` e `marcarInativosForaDaRun` são separados e sem transação.

- **Melhoria Proposta**
  > Usar o `transaction()` do `PostgreeDatabaseClient` nessas duas escritas; manter o `finishRun` fora, para a falha ser registrada. Em `TituloAPagarRepository.ts:61,130`. Tactic: Rollback.

- **Resultado Esperado**
  > Escritas de carteira atômicas: 0 de 2 → 2 de 2.

- **Tactic alvo**: Rollback
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-3
- **Métricas de sucesso**:
  - Escritas de carteira em transação: 0/2 → 2/2
- **Risco de não fazer**: em um incidente de banco, a carteira fica entre dois estados até a próxima run.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: só o delta (service, rota, hook). Fora do escopo: formação de lote, boleto/DDA, workflow CI.
- Nada de P0/P1: o refresh não escreve no ERP, o lock é por sessão (libera se o processo morre), e a aba fechada não aborta o servidor.
- Aba fechada: `vivo=false` só silencia o cliente; a ingestão termina no servidor e a próxima abertura vê `fresca`.
- Cross-QA: Availability (cron atrasado 2–5 h e reaper de 3–6 h), Performance (ingestão síncrona de ~9 s sob `heavyRouteLimiter`), Testability (falta teste de `finishRun` falhando no catch).
