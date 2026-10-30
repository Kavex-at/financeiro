---
qa: Availability
qa_slug: availability
run_id: 2026-10-30-sispag-dda-paridade-r2
agent: qa-availability
generated_at: 2026-10-30T00:00:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review (R2 delta: `sispag-dda-paridade`)

Escopo: apenas o delta não commitado da Rodada 2 do plano `ontology/_inbox/sispag-dda-paridade-plano.md` + emenda 2026-10-30 da ADR-0060. Arquivos avaliados: `.github/workflows/ingest-sispag.yml`, `src/backend/jobs/formar-lotes.ts`, `src/backend/domain/service/sispag/FormacaoLotesService.ts`, `src/backend/domain/service/sispag/BoletoDdaService.ts`, `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts`, `src/backend/migrations/0092_boleto_dda_conferencia.sql`, `src/frontend/app/sispag/components/BoletosDdaTab.tsx`. Infra AWS/Terraform não existe neste repo — métricas sobre DLQ/Lambda não se aplicam.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| GitHub Actions scheduler / usuário abrindo tela SISPAG | Slot cron atrasado ou perdido (:00 era atrasado ~16min); ou fin124 lento no caminho de abertura da tela | Pipeline `ingest-sispag` + endpoint de abertura da aba Boletos DDA | Dia útil, horário comercial, Conexos em HML/PRD | Mascarar falha com slots redundantes (05:07/07:07/12:13/16:13), formação idempotente (uma-por-dia via `job_execucao`), e cair graciosamente para `fresca` sem conferir quando o lock DDA está ocupado | Carteira ≤ 1h de defasagem no horário comercial; nenhuma formação duplicada; abertura de tela ≤ TTL mesmo com fin124 degradado |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Redundância de slots cron para ingestão | 4 slots/dia útil (05:07, 07:07, 12:13, 16:13 BRT) | ≥3 | ✅ | `.github/workflows/ingest-sispag.yml:21-30` |
| Trava "uma formação por dia" (idempotência) | advisory lock + `job_execucao` com `status IN (success,partial)` | advisory + persistente | ✅ | `FormacaoLotesService.ts:91-117` + `JobExecucaoRepository.ts:101-110` |
| Timeout da `conferir` DDA no caminho de abertura de tela | 60 000 ms (prazo total da passada) | ≤ 10 000 ms no caminho interativo | ⚠️ | `BoletoDdaService.ts:50,280,287` |
| Fallback quando listagem do fin124 falha na conferência | retorna `estado: FALHOU` com erro truncado, não lança | não lança no caminho interativo | ✅ | `BoletoDdaService.ts:297-305` + `CarteiraAtualizacaoService.ts:134-144` |
| Fallback quando lock DDA está ocupado na `conferir` | retorna `OCUPADA` sem tentar | não bloqueia a tela | ✅ | `BoletoDdaService.ts:265-269` |
| Alerta externo em falha de workflow (Monitor) | passo `alerta-workflow-falhou` com `if: failure()` e `continue-on-error` | presente e não mascara exit | ✅ | `.github/workflows/ingest-sispag.yml:75-98` |
| Concurrency guard do workflow | `group: ingest-sispag`, `cancel-in-progress: false` | não cancelar run em voo | ✅ | `.github/workflows/ingest-sispag.yml:33-35` |
| Retry/backoff interno em `job:ingest-pagamentos` dentro do workflow | ausente — depende do próximo slot | retry ou slot seguinte | ⚠️ | step `Ingestão de pagamentos` |

> ⚠️ **Não medível localmente**: taxa real de slots cron do GitHub que não dispararam (base para dimensionar o número de slots). Requer leitura da aba Actions em produção. Recomendação: registrar, no `detect-staleness`, o horário observado de `startedAt` por slot cron x cron agendado e emitir alerta ADR-0042 quando o gap > 30 min.

> ⚠️ **Não medível localmente**: p95 de latência da `conferir` sob fin124 lento. Recomendação: instrumentar `LogService.info` da `conferência rápida concluída` com `duracaoMs` e plotar no painel de operação.

## 3. Tactics — Cobertura no nf-projects (delta R2)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A (sem health-check externo entre serviços no delta) | N/A | — |
| Heartbeat | `job_execucao` grava `createRun/finishRun` por slot, consumido pelo `detect-staleness` | ✅ | `FormacaoLotesService.ts:132-157` |
| Monitor | Passo `alerta-workflow-falhou` + `detect-staleness` cobrem workflow morto antes de linha de run | ✅ | `ingest-sispag.yml:75-98` |
| Timestamp | `boleto_dda_conferencia.conferido_em` registra ÚLTIMA conversa bem-sucedida com o fin124 | ✅ | `migrations/0092_boleto_dda_conferencia.sql` |
| Sanity Checking | Guarda "dia útil + ≥06:30 + uma por dia" antes de formar | ✅ | `FormacaoLotesService.ts:103-118` |
| Condition Monitoring | `cabecalhoMudou` compara estado do arquivo DDA antes de regravar | ✅ | `BoletoDdaService.ts:420-424` |
| Voting | N/A | N/A | — |
| Exception Detection | `try/catch` nomeado em `conferir` com log `BUSINESS_WARN` e retorno tipado | ✅ | `BoletoDdaService.ts:297-305`, `CarteiraAtualizacaoService.ts:140-144` |
| Self-Test | ausente — não há probe no delta que exercite fin124 fora da demanda real | ❌ | — |
| Active Redundancy | N/A (single-tenant Render) | N/A | — |
| Passive Redundancy | 05:07 BRT é slot de "rede de segurança" cobrindo falha do 07:07 do dia anterior | ✅ | `ingest-sispag.yml:21-24` |
| Spare | 4 slots cron redundantes; `--manual` como spare operacional | ✅ | `ingest-sispag.yml:21-30,66-69` |
| Exception Handling | Falha de leitura de arquivo DDA individual é contada e logada sem derrubar o lote | ✅ | `BoletoDdaService.ts:385-414` |
| Rollback | Transação da `montarLote` desfaz tudo se um grupo não entra | ✅ | `FormacaoLotesService.ts:300-363` |
| Software Upgrade | N/A no delta | N/A | — |
| Retry | ausente dentro do workflow; o retry é "próximo slot" (grosseiro) | ⚠️ | — |
| Ignore Faulty Behavior | arquivos sumidos do fin124 — avisa e mantém snapshot (nunca apaga) | ✅ | `BoletoDdaService.ts:317-324` |
| Degradation | `gruposOuNenhum` desliga só o resumo de grupo; `conferirDda` falha → carteira fica `fresca` sem DDA | ✅ | `BoletoDdaService.ts:143-159`, `CarteiraAtualizacaoService.ts:128-144` |
| Reconfiguration | slots cron fora da hora cheia é reconfiguração deliberada contra atraso do scheduler | ✅ | header de `ingest-sispag.yml` |
| Shadow | N/A no delta | N/A | — |
| State Resynchronization | `conferir` reconcilia snapshot ↔ fin124 (novos / cabeçalho / sumidos) | ✅ | `BoletoDdaService.ts:307-324` |
| Escalating Restart | N/A | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | formação pulada em dia não útil / antes das 06:30 / se já rodou hoje | ✅ | `FormacaoLotesService.ts:103-118` |
| Transactions | `withTransaction` + `withAdvisoryLock` por rodada; locks nomeados distintos por fluxo | ✅ | `FormacaoLotesService.ts:33,91` e `BoletoDdaService.ts:38,183-201` |
| Predictive Model | ausente | ❌ | — |
| Exception Prevention | lock advisory + trava "uma por dia" previnem fragmentação de lotes | ✅ | `FormacaoLotesService.ts:85-101` |
| Increase Competence Set | N/A no delta | N/A | — |

## 4. Findings (achados)

### F-availability-1: `conferir` DDA roda síncrona no caminho de abertura da tela com prazo de 60 s e sem timeout por chamada

- **Severidade**: P1
- **Tactic violada**: Timeout (Exception Detection) / Degradation parcial
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:50,261-281,287-305`; `src/backend/domain/service/sispag/CarteiraAtualizacaoService.ts:83-93,129-144`
- **Evidência (objetiva)**:
  ```
  BoletoDdaService.ts:50   export const BOLETO_DDA_PRAZO_MS = 60_000;
  BoletoDdaService.ts:280  return this.conferir({ triggeredBy, prazoMs: BOLETO_DDA_PRAZO_MS });
  BoletoDdaService.ts:287  const limite = Date.now() + (input.prazoMs ?? BOLETO_DDA_PRAZO_MS);
  CarteiraAtualizacaoService.ts:87-92  (await na abertura, dentro de req HTTP)
  ```
- **Impacto técnico**: na emenda 2026-10-30 da ADR-0060 o caminho `fresca` passou a chamar `conferirSeVelho` DENTRO da mesma request Express. O orçamento é 60 s totais, mas é um orçamento de **lote** — não há timeout por chamada ao `fin124` (`dda.listarArquivos` / `dda.listarItens`). Se o Conexos travar numa única leitura, a request fica presa até o `limite` ser verificado no próximo item (worst case = 60 s). Em Render com workers Express fixos, N abas abertas em paralelo saturam o pool.
- **Impacto de negócio**: usuário analista do SISPAG vê tela de abertura "pendurada"; abas concorrentes de outros fluxos (Permutas, extratos) ficam sem worker. O recurso que o R2 queria entregar (DDA quente antes do expediente) vira risco de indisponibilidade do próprio painel.
- **Métrica de baseline**: `BOLETO_DDA_PRAZO_MS = 60_000` ms no caminho interativo. Alvo defensável: ≤ 10 000 ms no caminho interativo (abertura de tela), 60 000 ms só no cron/job.

### F-availability-2: ausência de retry/backoff em `job:ingest-pagamentos` dentro do workflow — recuperação depende exclusivamente do próximo slot

- **Severidade**: P2
- **Tactic violada**: Retry
- **Localização**: `.github/workflows/ingest-sispag.yml:62-64`
- **Evidência (objetiva)**:
  ```
  - name: Ingestão de pagamentos (carteira titulo_a_pagar)
    run: npm run job:ingest-pagamentos
  ```
  O step não tem `retry`, backoff, nem `continue-on-error`. Se o `job:ingest-pagamentos` falhar transientemente (blip Conexos, 403 esporádico), o workflow falha e o passo `job:formar-lotes` do mesmo slot nem é chamado.
- **Impacto técnico**: a redundância é por "próximo slot" (05:07 → 07:07 → 12:13). Em dia de instabilidade do Conexos à primeira hora, a formação pode ser adiada até 12:13 (≈ 7h depois do primeiro slot). O cooldown do `CarteiraAtualizacaoService` ainda penaliza aberturas de tela nesse intervalo.
- **Impacto de negócio**: lotes do dia só aparecem na tela à tarde; analista inicia a jornada sem a carteira formada.
- **Métrica de baseline**: 0 retries internos; MTTR = `tempo_até_próximo_slot` (worst case 5h08min entre 07:07 e 12:13).

### F-availability-3: sem Self-Test ativo do fin124 fora da demanda — só se descobre que o pool está mudo quando um usuário abre a tela ou o cron roda

- **Severidade**: P3
- **Tactic violada**: Self-Test
- **Localização**: pipeline `sispag` como um todo; delta não introduz probe dedicado
- **Evidência (objetiva)**: `boleto_dda_conferencia` só grava em listagem bem-sucedida iniciada por `abertura:*`, `ingestao:cron` ou `manual:*` (`migrations/0092_boleto_dda_conferencia.sql`). Entre o último slot do dia anterior (16:13 BRT) e o 05:07 do dia útil seguinte, não há sonda. O `detect-staleness` detecta atraso retrospectivo, não disponibilidade atual.
- **Impacto técnico**: janelas de ~13h sem evidência de que o fin124 responde; descoberta de problema é empurrada para o usuário.
- **Impacto de negócio**: diagnóstico mais lento no caso de pane do ERP durante a madrugada / fim de semana.
- **Métrica de baseline**: 0 probes/dia fora dos 4 slots agendados.

## 5. Cards Kanban

### [availability-1] Separar prazo da conferência interativa do prazo do batch

- **Problema**
  > A emenda 2026-10-30 da ADR-0060 fez a abertura da tela SISPAG aguardar `BoletoDdaService.conferir` com o mesmo `BOLETO_DDA_PRAZO_MS = 60 000` que o cron usa. Em instabilidade do fin124, um worker Express fica preso até 60 s por abertura; N analistas abrindo em paralelo saturam o pool do Render.
- **Melhoria Proposta**
  > Introduzir dois prazos distintos: `BOLETO_DDA_PRAZO_INTERATIVO_MS` (default 10 000) no caminho `CarteiraAtualizacaoService.conferirDda`, e manter `BOLETO_DDA_PRAZO_MS` no cron/job. Adicionar timeout por chamada no `ConexosDdaClient.listarArquivos` / `listarItens` (axios `timeout` ≤ 7 s) para falhar rápido no primeiro item travado. Tactic alvo: **Timeout + Degradation**.
- **Resultado Esperado**
  > p95 do passo "abertura de tela" ≤ 2 s em condição normal, ≤ 10 s em fin124 degradado. Nunca prender worker > 10 s no caminho interativo.
- **Tactic alvo**: Timeout / Degradation
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - prazo interativo DDA: 60 000 ms → ≤ 10 000 ms
  - timeout explícito por chamada `fin124`: ausente → ≤ 7 000 ms
- **Risco de não fazer**: um fin124 lento (já observado em HML — ver nota de 2026-10-20 em ADR-0077) vira indisponibilidade do painel inteiro, não só da aba DDA.
- **Dependências**: nenhuma

### [availability-2] Retry com backoff curto em `job:ingest-pagamentos` dentro do workflow

- **Problema**
  > O step de ingestão não tem retry interno; falha transiente no primeiro slot da manhã empurra a formação para o próximo slot (worst case 05:07 → 07:07 → 12:13, ~7 h). Enquanto isso, aberturas de tela ficam em `FALHA_RECENTE` por conta do cooldown.
- **Melhoria Proposta**
  > Envolver o comando `npm run job:ingest-pagamentos` em um retry (2 tentativas, backoff 60 s) usando `nick-fields/retry@v3` ou laço bash, com log claro de qual tentativa quebrou. Alternativa menos invasiva: aceitar e documentar que o retry é por slot cron, e **adicionar métrica no `detect-staleness`** que distingue "slot não disparou" de "slot disparou e falhou". Tactic alvo: **Retry**.
- **Resultado Esperado**
  > Falha transiente única não cancela o passo de formação do mesmo slot. Visibilidade clara de retries no run do workflow.
- **Tactic alvo**: Retry
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - retries internos: 0 → 2 com backoff 60 s
  - MTTR em falha transiente: `tempo_até_próximo_slot` → ≤ 3 min
- **Risco de não fazer**: dia com Conexos "nervoso" no 06:00 BRT (ADR-0067) acumula atraso até 12:13 e analistas começam a formar manualmente, fragmentando lotes.
- **Dependências**: nenhuma

### [availability-3] Probe de disponibilidade do fin124 fora dos slots de ingestão

- **Problema**
  > Entre 16:13 BRT e 05:07 BRT do dia útil seguinte não há conferência agendada; descoberta de pane do fin124 depende do usuário. O timestamp `boleto_dda_conferencia.conferido_em` cobre defasagem retrospectiva, não disponibilidade imediata.
- **Melhoria Proposta**
  > Criar `job:probe-fin124` leve (uma `listarArquivos` com timeout curto, sem gravação) agendado 1x fora do horário comercial (ex.: 21:00 BRT dia útil) e 1x no sábado. Resultado grava apenas em `log` + atualiza `conferido_em` se bem-sucedido. Tactic alvo: **Self-Test**.
- **Resultado Esperado**
  > Pane noturna/fim-de-semana do fin124 é detectada antes da primeira abertura de tela do dia útil seguinte.
- **Tactic alvo**: Self-Test
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - probes/dia fora dos 4 slots: 0 → ≥ 1
  - janela máxima sem evidência de fin124 disponível: ~13 h → ≤ 10 h
- **Risco de não fazer**: baixo em dia útil (slots cobrem); real em feriadão prolongado quando o 05:07 do próximo dia útil é a primeira oportunidade de descobrir pane.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo limitado ao delta R2 (uncommitted). Não revisei a R1 — findings dela estão em `../2026-10-30-sispag-dda-paridade/availability.md` (se existir) ou herdados no REPORT consolidado.
- Métricas de produção (p95 fin124, slots cron atrasados) não medíveis a partir do repo; marcadas explicitamente.
- Cross-QA: F-availability-1 também é um **finding de performance** (latência de abertura de tela) e de **testability** (falta teste integrado simulando `conferir` com fin124 lento). Flaggar para o `qa-consolidator`.
