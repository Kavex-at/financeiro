---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-30-sispag-dda-paridade-r2
agent: qa-fault-tolerance
generated_at: 2026-10-30T00:00:00Z
scope: backend
score: 8
findings_count: 5
cards_count: 5
---

# Fault Tolerance — Regis-Review (Rodada 2)

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| GitHub Actions scheduler + abertura de tela | Dois cron slots (05:07 e 07:07 BRT) disparam quase juntos / processo do job cai no meio da formação / `fin124` indisponível na conferência rápida | `FormacaoLotesService.formar`, `BoletoDdaService.conferir`, `JobExecucaoRepository`, `boleto_dda_conferencia` | Produção com Conexos saudável, com Conexos degradado, ou com worker derrubado mid-run | Advisory lock serializa; trava "uma por dia BRT" é lida DENTRO do lock; conferência que falha nunca degrada o estado da carteira; lista vazia nunca apaga snapshot | 0 formações duplicadas no mesmo dia BRT; 0 reset silencioso do snapshot DDA; 100% das rodadas abrem+fecham `job_execucao` ou são retomáveis sem efeito colateral |

Observação de contorno: o único "financial write" neste delta é a **criação de lote RASCUNHO** no Postgres. Nada aqui dispara remessa ao banco. O bar P0 ("sem double-execution de escrita financeira") se traduz em "sem fragmentar o lote formando duas vezes no mesmo dia".

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Checagem "ja_formado_hoje" dentro do advisory lock | sim | obrigatório | ✅ | `FormacaoLotesService.ts:91-107` (`motivoParaPular` chamado dentro de `withAdvisoryLock`) |
| `existeConcluidaDesde` só conta `success`/`partial` | sim | sim (um `error` ou `running` não deve travar retry) | ✅ | `JobExecucaoRepository.ts:96-104` |
| Dia civil BRT como fronteira (`startOfTodayBrt`) | sim | sim (evitar drift às 09:00 BRT, cf. ADR-0070) | ✅ | `FormacaoLotesService.ts:131` |
| Trilha `job_execucao` aberta+fechada em todo caminho | aberto no `comTrilha`, fechado em `success`/`error` | 100% dos caminhos não-`pulado` | ✅ | `FormacaoLotesService.ts:117-144` |
| Lista `fin124` vazia sobre snapshot cheio não apaga | guarda `EmptyDdaFileError` ativa também no caminho da conferência (mesmo `salvarArquivo`) | obrigatório | ✅ | `BoletoDdaRepository.ts:59-66` |
| Falha de conferência preserva estado da carteira | sim: capturada em `conferirDda`, retornada como `dda.estado=falhou` | obrigatório | ✅ | `CarteiraAtualizacaoService.ts:125-141` |
| Reaper de `job_execucao` em `running` velho (reclaim) | ausente para `sispag-formacao-lotes` | existir ou status timeout | ⚠️ | não encontrado no delta |
| Idempotência do `registrarConferencia` quando `lerArquivos` retornou só falhas | registra mesmo com `arquivosLidos=0` desde que a listagem tenha dado certo | depende do critério "listagem = conferência" | ⚠️ | `BoletoDdaService.ts:280-285` (passada completa) e `BoletoDdaService.ts:360-365` (conferência rápida) |
| Gate do passo de formação no workflow — string match frágil | igualdade exata da expressão cron (`'7 8 * * 1-5'`, etc.) | marcador explícito (input/env) | ⚠️ | `.github/workflows/ingest-sispag.yml:70-79` |
| `--manual` via `workflow_dispatch` bypassa a trava | sim (documentado) | aceito (equivalente ao botão da tela) | ✅ | `.github/workflows/ingest-sispag.yml:84-86`, `jobs/formar-lotes.ts:16-23` |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | `EmptyDdaFileError` guarda arquivo vazio sobre snapshot cheio; conferência não registra se `listarArquivos` falhou | ✅ | `BoletoDdaRepository.ts:59-66`, `BoletoDdaService.ts:333-345` |
| Timeout | `prazoMs` orçamentando a passada; itens em voo terminam, resto vira `arquivosAdiados` | ✅ | `BoletoDdaService.ts:396-402` |
| Condition Monitoring | `job_execucao`, `boleto_dda_conferencia` deixam rastro para alerta/painel | ✅ | migration `0092`, `JobExecucaoRepository` |
| Timestamp | `startOfTodayBrt`/`todayBrt` como fronteira do dia civil (não `now()`) | ✅ | `FormacaoLotesService.ts:131,186` |
| Redundancy (passive) | 4 cron slots (05:07, 07:07, 12:13, 16:13), com `concurrency: ingest-sispag` e trava "uma por dia" | ✅ | workflow + `FormacaoLotesService` |
| Rollback | Cada `montarLote` é `withTransaction` — grupo que não entra desfaz o lote inteiro | ✅ | `FormacaoLotesService.ts:306-367` |
| Idempotent Replay | `registrarConferencia` é UPSERT em `id=1`; `atualizarCabecalho` é UPDATE sem itens; lotes já formados são excluídos da próxima rodada via `listElegiveisParaFormacao` | ✅ | `BoletoDdaRepository.ts:216-231`, `0092_boleto_dda_conferencia.sql` |
| Voting / Comparison | listagem × snapshot comparados por diff (novos/mudados/sumidos) antes de qualquer escrita | ✅ | `BoletoDdaService.ts:347-357` |
| Removal from Service (Quarantine) | Falha da conferência retorna `dda.estado=falhou` embutido; a carteira segue `fresca` | ✅ | `CarteiraAtualizacaoService.ts:125-141` |
| Reintroduction / State Resync | ausente para `job_execucao` em `running` órfão (crash mid-run); recupera por via oblíqua (próximo slot forma o resíduo porque títulos lotados saem da elegibilidade) | ⚠️ parcial | `FormacaoLotesService.ts:117-144` |
| Exception Prevention (type-level) | `FormacaoPulada` como literal typed, `ConferenciaDda.estado` tipado | ✅ | `SispagInterface.ts`, `BoletoDda.ts` |
| Compensating Transaction | N/A — não há escrita externa (ERP) no delta; só Postgres | N/A | — |

## 4. Findings

### F-fault-tolerance-1: `job_execucao` em `running` órfão não é reclamado

- **Severidade**: P2
- **Tactic violada**: Reintroduction / State Resync
- **Localização**: `src/backend/domain/service/sispag/FormacaoLotesService.ts:117-144`; `src/backend/domain/repository/operacao/JobExecucaoRepository.ts:63-72`
- **Evidência**:
  ```
  createRun → status 'running'
  (sem reaper para linhas 'running' envelhecidas do pipeline sispag-formacao-lotes)
  existeConcluidaDesde(..) só vê 'success'|'partial'
  ```
- **Impacto técnico**: Se o runner do GitHub cai entre `createRun` e `finishRun`, a linha fica `running` para sempre. O comportamento ainda é seguro: o próximo slot não é bloqueado (a trava só olha `success/partial`) e a formação é forward-recoverable (títulos já lotados saem da elegibilidade). Mas a linha `running` zumbi polui métricas e o `detect-staleness` não a transforma em `error` (CLAUDE.md diz: "`running` não é `error`").
- **Impacto de negócio**: Observabilidade degradada — a Rodada 1 (`REPORT.md`) marcou staleness como item do radar; aqui a mesma cegueira retorna pelo pipeline novo.
- **Métrica de baseline**: 0 reaper para pipeline `sispag-formacao-lotes`; mesmo gap documentado para `sispag-pagamentos` no workflow (passo "Alertar falha" cobre só runner-dies, não process-dies-mid-run).

### F-fault-tolerance-2: Gate do passo "Formação automática" por igualdade de string de cron é frágil

- **Severidade**: P2
- **Tactic violada**: Avoid Faults (Substitution/Replacement) — gate "silencioso em caso de typo"
- **Localização**: `.github/workflows/ingest-sispag.yml:69-80`
- **Evidência**:
  ```yaml
  if: >-
    github.event_name == 'schedule' &&
    (github.event.schedule == '7 8 * * 1-5' ||
     github.event.schedule == '7 10 * * *' ||
     github.event.schedule == '13 15 * * 1-5')
  ```
- **Impacto técnico**: Qualquer edição futura do schedule (um minuto trocado, um dia-da-semana ajustado) sem atualizar simultaneamente a condição desliga a formação **em silêncio** — a ingestão continua, mas o `job:formar-lotes` nunca é chamado. Nada avisa.
- **Impacto de negócio**: lotes do dia podem simplesmente não ser formados a partir da próxima manhã sem erro visível. O comentário acima da seção documenta o acoplamento, mas não protege.
- **Métrica de baseline**: 3 strings de cron duplicadas entre `on.schedule` e o `if:` do passo — alvo: 0.

### F-fault-tolerance-3: `registrarConferencia` carimba liveness mesmo quando 100% das leituras de arquivo falharam

- **Severidade**: P3
- **Tactic violada**: Sanity Checking (critério de "conferência bem-sucedida")
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:260-285` (passada completa); `BoletoDdaService.ts:355-369` (conferência rápida)
- **Evidência**: a chamada `registrarConferencia` roda assim que `listarArquivos` sucede, independentemente de `falhas === alvo.length` em `lerArquivos`. O comentário "I-DDA7: a listagem deu certo — é uma conferência" é explícito, mas no caso extremo isso move o relógio da staleness para frente mesmo que nenhum arquivo tenha sido efetivamente lido.
- **Impacto técnico**: `conferirSeVelho` passa a dormir o intervalo configurado antes de tentar de novo; o aviso de "DDA parado" no FE (`horasDdaDefasado`) é postergado.
- **Impacto de negócio**: analista pode trabalhar por mais 10 min achando o DDA "ok" quando na prática nenhum arquivo foi lido.
- **Métrica de baseline**: nenhum teste cobre o cenário "`listarArquivos` OK + todas as leituras de item falhadas → conferência deve/não deve ser registrada?". Decisão hoje: registra.

### F-fault-tolerance-4: Trava "uma por dia" convive com `--manual` sem log de alerta de double-dispatch

- **Severidade**: P3
- **Tactic violada**: Detect Faults (Comparison)
- **Localização**: `src/backend/jobs/formar-lotes.ts:16-23`; `FormacaoLotesService.ts:94-96`
- **Evidência**: `triggeredBy === 'manual'` ou `automatica === false` ignoram `motivoParaPular`. Não há log distinto quando o manual roda **após** uma rodada já concluída no dia.
- **Impacto técnico**: inofensivo — `listElegiveisParaFormacao` exclui títulos já lotados, então o segundo manual forma 0 lotes. Mas também não há sinal "você está refazendo o que já foi feito hoje".
- **Impacto de negócio**: baixo; mitigado pelo fato de o botão da tela respeitar a mesma política.
- **Métrica de baseline**: 0 logs específicos de "manual over already-formed day".

### F-fault-tolerance-5: `conferir` dentro do advisory lock da sincronização bloqueia a passada completa concorrente, e vice-versa

- **Severidade**: P3
- **Tactic violada**: N/A — é escolha explícita (compartilhar `BOLETO_DDA_SYNC_LOCK_KEY`), mas vale documentar
- **Localização**: `src/backend/domain/service/sispag/BoletoDdaService.ts:294-303`
- **Evidência**: `conferir` usa `BOLETO_DDA_SYNC_LOCK_KEY = 726354820` — o mesmo lock de `sincronizar`. `ocupada` é retornado quando colide.
- **Impacto técnico**: ao abrir a tela durante a passada completa do cron, a conferência retorna `OCUPADA` e o FE perde a chance de pegar um arquivo DDA novo nessa abertura; a passada completa fecha e o próximo refresh do painel resolve. Comportamento consciente, mas sem teste explícito do caminho `OCUPADA` originado por `sincronizar` corrente.
- **Impacto de negócio**: pequeno; janela de ~30-60 s por slot.
- **Métrica de baseline**: nenhum teste cobre explicitamente a colisão `conferir × sincronizar`.

## 5. Cards Kanban

### [fault-tolerance-1] Marcar `running` velhos de `sispag-formacao-lotes` como `error`

- **Problema**
  > Crash do processo entre `createRun` e `finishRun` deixa `job_execucao` em `running` indefinidamente. A trava "uma por dia" ignora, então o próximo slot cobre o buraco de formação — mas a linha zumbi fica fora do radar de alertas (`running` ≠ `error`).

- **Melhoria Proposta**
  > Reaper (job ou extensão do `detect-staleness` existente) que marca como `error` toda `job_execucao` em `running` do pipeline `sispag-formacao-lotes` iniciada há mais do que N × duração-mediana. Tactic: Reintroduction / State Resync. Arquivos: `src/backend/jobs/detect-staleness.ts` (ou análogo), `JobExecucaoRepository` (método `reclaimStaleRunning`).

- **Resultado Esperado**
  > Linhas `running` órfãs convertidas em `error` em até 15 min, visíveis no mesmo painel de staleness da ingestão.

- **Tactic alvo**: Reintroduction (State Resync)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Linhas `running` com `started_at < now() - 30 min`: hoje invisíveis → 0 após reaper
  - Alertas de staleness cobrindo pipeline `sispag-formacao-lotes`: 0 → 1
- **Risco de não fazer**: 6 meses de linhas `running` entulhando a tabela e falhas reais de formação passando sem alerta.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Substituir string-match de cron por marcador explícito

- **Problema**
  > O passo "Formação automática de lotes" é habilitado por igualdade exata da expressão cron do schedule. Qualquer edição futura do schedule desliga a formação sem erro visível.

- **Melhoria Proposta**
  > Trocar o `if:` por um marcador explícito: ou (a) acrescentar `env: { FORMAR: 'true' }` por entrada do `schedule` via matriz, ou (b) adicionar um step preliminar que escreve `formation_enabled=true` em `$GITHUB_OUTPUT` com uma única fonte de verdade (lista de cron strings). Tactic: Avoid Faults (Substitution).

- **Resultado Esperado**
  > Edição do schedule não quebra o gate silenciosamente.

- **Tactic alvo**: Avoid Faults
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Pontos de duplicação da string de cron: 2 (schedule + if) → 1
- **Risco de não fazer**: formação some de produção um dia sem ninguém perceber até lote vencer.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Decidir e testar o critério de "conferência registrada"

- **Problema**
  > `registrarConferencia` carimba `conferido_em` mesmo quando `listarArquivos` sucedeu e todas as leituras subsequentes falharam. O aviso "DDA parado" é postergado por `SISPAG_DDA_CONFERENCIA_MIN` nesse caso.

- **Melhoria Proposta**
  > Documentar explicitamente (ADR ou linha na ontologia I-DDA7) e cobrir com teste: "conferência registra se e somente se a LISTAGEM do fin124 deu certo"? Se a decisão for "listagem = conferência", acrescentar um sub-marcador (`arquivos_falhados`) e deixar o FE escalar o aviso quando o último `conferido_em` teve `arquivos_lidos=0 ∧ arquivos_falhados>0`. Tactic: Sanity Checking.

- **Resultado Esperado**
  > Analista enxerga "DDA conferido às X, com 0 lidos / N falhados" em vez de só o timestamp.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes cobrindo "all-files-fail" na passada completa e na rápida: 0 → 2
- **Risco de não fazer**: janela de 10 min em que o FE mente sobre o frescor do DDA.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Log de observabilidade quando `--manual` roda num dia já formado

- **Problema**
  > O override `--manual` ignora a trava "uma por dia" sem deixar sinal distinto no `job_execucao` ou nos logs.

- **Melhoria Proposta**
  > Em `FormacaoLotesService.formar`, quando `!automatica` e `existeConcluidaDesde` retorna `true`, emitir um `logService.info` dedicado ("formação manual sobrescrevendo rodada do dia") e gravar `metricas.manualOverDay=1`. Tactic: Detect Faults (Comparison).

- **Resultado Esperado**
  > Rastro no painel diferencia manual-ocioso de manual-por-cima.

- **Tactic alvo**: Detect Faults (Comparison)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Discriminação de override manual nos logs: ausente → presente.
- **Risco de não fazer**: nenhum operacional; só diagnóstico.
- **Dependências**: nenhuma.

### [fault-tolerance-5] Teste da colisão `conferir × sincronizar` sobre o mesmo lock

- **Problema**
  > `conferir` e `sincronizar` compartilham `BOLETO_DDA_SYNC_LOCK_KEY = 726354820`. É escolha correta (um não deve começar enquanto o outro corre), mas não há teste que exercite o caminho `OCUPADA` originado por `sincronizar` em voo.

- **Melhoria Proposta**
  > Teste de integração que inicia `sincronizar` (com `lerArquivos` segurado por `defer`) e, em paralelo, chama `conferir` esperando `estado: 'ocupada'`. Tactic: Detect Faults (Timeout + Condition Monitoring).

- **Resultado Esperado**
  > Caminho `OCUPADA` protegido por teste de regressão.

- **Tactic alvo**: Detect Faults
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Cobertura do caminho `OCUPADA` de `conferir`: 0 → 1 teste.
- **Risco de não fazer**: regressão silenciosa se alguém trocar a chave do lock da conferência.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Delta é defensivamente codificado: lock + "uma por dia" dentro do lock + `success/partial` only + dia civil BRT + transação por lote + guarda de arquivo vazio + conferência isolada por lock compartilhado — nenhum P0/P1 identificado.
- Cross-QA: F-fault-tolerance-1 duplica o fio do `detect-staleness` já visto na Rodada 1 (Testability + Performance); F-fault-tolerance-2 toca Deployability (gate CI frágil); F-fault-tolerance-3 toca UX/Usability do aviso DDA.
- Audit-trail invariant: toda transição aqui (`createRun`/`finishRun`, `registrarConferencia`, `salvarArquivo`) deixa rastro persistido — sem brecha.
