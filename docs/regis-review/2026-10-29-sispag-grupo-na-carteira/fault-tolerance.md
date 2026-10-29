---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-29-sispag-grupo-na-carteira
agent: qa-fault-tolerance
generated_at: 2026-10-29T00:00:00Z
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "confirmar" no boleto do grupo da RHENUS pela aba da carteira (1:1) enquanto o motor de grupos sugere o mesmo boleto | Tentativa de confirmar 1:1 um boleto que pertence a uma SUGESTÃO de grupo (I21v); ou falha parcial na leitura das marcas de bloqueio (banco fora, timeout) | `BoletoSuggestionService.confirmar` + `MotorSugestaoBoleto.aplicarGrupoSugerido` + fallback `gruposSugeridos` | Operação normal, cache de 30 s single-flight da listagem | Recusar o 1:1 com 409 + motivo; degradar para o 1:1 anterior quando o motor de grupos falha (fail-closed sem derrubar a tela); não gravar decisão nenhuma; não perder evidência (log.warn) | 0 decisões `CONFIRMADA` gravadas no caminho recusado; 100 % das falhas de `bloqueioRepo.listAtivos` logadas; 0 regressões no 1:1 UNICA_SEGURA de títulos fora do grupo |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes do motor cobrindo I21v (grupo sugerido na carteira) | 10 cenários no `MotorSugestaoBoleto.grupoSugerido.test.ts` + 4 no `BoletoSuggestionService.test.ts` | ≥ 1 por invariante (I21v, I21w, fail-closed) | ✅ | `src/backend/domain/service/sispag/MotorSugestaoBoleto.grupoSugerido.test.ts:102-274`; `BoletoSuggestionService.test.ts:1987-2070` |
| Caminho de recusa 1:1 do boleto do grupo gera erro nomeado antes de qualquer `inserirDecisao` | Sim — `sugestaoConfirmavel` lança `BoletoSuggestionNotAvailableError` com motivo "Boletos agrupados" | 100 % | ✅ | `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1287-1295` |
| Fail-closed na leitura de `bloqueioRepo.listAtivos` (marcas) | Catch + `logService.warn` + `return undefined` que o chamador converte em `gruposSugeridos: []` | Fail-closed com evidência | ⚠️ | `BoletoSuggestionService.ts:1095-1110` e `:1172-1182` |
| Fail-closed no `motorGrupo.sugerir` (qualquer exceção derruba só o grupo) | Catch + `logService.warn` + `return []` | Fail-closed com evidência | ⚠️ | `BoletoSuggestionService.ts:1117-1134` |
| Mutação da entrada do motor 1:1 pela aplicação da sugestão de grupo | Nenhuma — `JSON.stringify(e)` igual antes/depois | 0 mutações | ✅ | `MotorSugestaoBoleto.grupoSugerido.test.ts:190-195` |
| Reserva indevida de boleto por título do grupo (perder 1:1 de rival em silêncio) | `alocaveis` filtra candidatos a `forca <= 1` para títulos marcados; teste "A não reserva X e B leva X" cobre | 0 regressões | ✅ | `MotorSugestaoBoleto.ts:349-356`; `MotorSugestaoBoleto.grupoSugerido.test.ts:229-241` |
| Exceção de seguro: título de FORA com 1:1 CONHECIDO/FORTE preserva o boleto | `sugestoesValidas` filtra a sugestão | Preservado | ✅ | `MotorSugestaoBoleto.ts:515-534`; teste `MotorSugestaoBoleto.grupoSugerido.test.ts:259-273` |
| Idempotência da sugestão de grupo frente a decisão 1:1 ativa | motor-grupo exclui boleto com `decisoesConfirmadas` em `candidatos()`; motor-1:1 preserva CONFIRMADA via `SITUACOES_QUE_MANTEM` | Sem conflito | ✅ | `MotorGrupoBoleto.ts:190-194`; `MotorSugestaoBoleto.ts:164-170` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | O motor rejeita confirmar 1:1 um boleto de sugestão de grupo em `sugestaoConfirmavel`; releitura do banco em `confirmar` continua ao vivo (anti-TOCTOU) | ✅ presente | `BoletoSuggestionService.ts:1281-1302` |
| Comparison | `sugestoesValidas` compara o boleto do grupo contra os candidatos seguros de títulos de fora do grupo (preserva 1:1 pré-existente) | ✅ presente | `MotorSugestaoBoleto.ts:515-534` |
| Timeout | N/A — o motor é puro, sem I/O; o Postgres continua com os timeouts do pool herdado | N/A | — |
| Condition Monitoring | `logService.warn` em cada fallback (`marcasOuNenhuma`, `gruposSugeridos`) emite evidência observável | ⚠️ parcial | `BoletoSuggestionService.ts:1101-1108`, `:1127-1133` — sem métrica agregada |
| Voting | N/A — não há replicação | N/A | — |
| Redundancy | N/A — motor puro em processo | N/A | — |
| Exception / Rollback | Fail-closed por fallback (sem rollback transacional porque o motor não escreve); o `confirmar` que escreve segue com `db.withTransaction` existente | ✅ presente | `BoletoSuggestionService.ts:381-496` (inalterado), `:1117-1134` (novo fallback) |
| Idempotent Replay | Cache `SugestaoBoletoCache` single-flight de 30 s; chama `cache.invalidar()` após qualquer decisão/grupo mudar | ✅ presente | `BoletoSuggestionService.ts:498, 638, 713, 772` |
| Reconcile | O desfecho é recomputado por execução do motor; não há reconciliação com Conexos neste delta (motor puro) | N/A | — motor sem write-back |
| Compensating Transaction | N/A — motor não escreve; a transação do grupo (fora deste delta) já tem anti-TOCTOU | N/A | — |
| Quarantine | A refusal de 1:1 do boleto do grupo é a quarentena de fato: o boleto não é confirmável até o grupo ser confirmado/anulado | ✅ presente | `MotorSugestaoBoleto.ts:396-416`; `BoletoSuggestionService.ts:1286-1295` |
| Audit (via LogService) | Falhas de fallback são logadas; a recusa 1:1 não gera evento porque nada foi gravado | ✅ presente | `BoletoSuggestionService.ts:1066-1072, 1085-1092, 1101-1108, 1127-1133` |

## 4. Findings (achados)

### F-fault-tolerance-1: Fail-closed de `bloqueioRepo.listAtivos` reintroduz silenciosamente o defeito que o ADR corrige

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Condition Monitoring (fallback audível só por `log.warn`, sem métrica/alerta)
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1095-1110`, `:1172-1182`
- **Evidência (objetiva)**:
  ```ts
  // marcasOuNenhuma: retorno undefined desliga a sugestão de grupo
  private marcasOuNenhuma = async (): Promise<... | undefined> => {
      try { return await this.bloqueioRepo.listAtivos(); }
      catch (err) { await this.logService.warn(...); return undefined; }
  };
  // sugerirAgora: undefined => gruposSugeridos = []
  const gruposSugeridos = marcas ? await this.gruposSugeridos({...}) : [];
  ```
- **Impacto técnico**: enquanto o Postgres (ou só a tabela `bloqueio_duplicidade`) falha intermitentemente, a tela da carteira volta ao comportamento pré-emenda do ADR-0077: o boleto do grupo RHENUS vira candidato 1:1 confirmável para o 5566, exatamente o defeito do PRD 2026-10-29. O servidor não recusa porque o próprio `desfechos` passado a `sugestaoConfirmavel` não tem `grupoSugerido`.
- **Impacto de negócio**: janela de reocorrência do incidente financeiro durante indisponibilidade parcial do banco; o analista pode pagar um título individual com o boleto que paga o grupo inteiro, duplicando a saída de caixa (R$ 26.369,85 no caso do PRD) até a conciliação detectar.
- **Métrica de baseline**: 1 % de falhas em `bloqueioRepo.listAtivos` durante janela de 30 s do cache = 1 % de leituras da carteira sem a trava do grupo; sem alarme automático atrelado (`log.warn` sem agregação).

### F-fault-tolerance-2: Catch total em `gruposSugeridos` sem código do erro

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/service/sispag/BoletoSuggestionService.ts:1117-1134`
- **Evidência (objetiva)**:
  ```ts
  } catch (err: unknown) {
      await this.logService.warn({ ... data: { erro: err instanceof Error ? err.message : String(err) } });
      return [];
  }
  ```
- **Impacto técnico**: o warn carrega apenas `err.message`. Qualquer `code` nativo do pg/driver (`53300`, `ECONNRESET`, etc.) é perdido, dificultando correlacionar falhas repetidas do fallback com um incidente de infra.
- **Impacto de negócio**: aumenta o MTTR de incidentes do tipo "a carteira sumiu a sugestão de grupo intermitentemente".
- **Métrica de baseline**: 0 campos estruturados além de `erro: string`.

### F-fault-tolerance-3: `totalCandidatos` reportado como 0 em `GRUPO_SUGERIDO` oculta candidatos ATENCAO

- **Severidade**: P3 (baixo — observabilidade/UX)
- **Tactic violada**: — (não é falha de tolerância a falhas; achado adjacente anotado para cross-QA)
- **Localização**: `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts:349-356`, `:1178-1215`
- **Evidência (objetiva)**: `alocaveis` filtra `candidatos` a `forca <= 1` para títulos marcados; `alocarDesfechos` usa `alocaveis` tanto para `candidatos` quanto para `totalCandidatos`. Resultado: um título em grupo sugerido com ATENCAO ancorada reporta `totalCandidatos: 0` mesmo havendo pares no envelope.
- **Impacto técnico**: a tela do título em `GRUPO_SUGERIDO` perde a informação de que ainda haveria candidatos ATENCAO fora do grupo caso o analista anulasse o grupo.
- **Impacto de negócio**: menor, cosmético — o fluxo intencional de "confirme no agrupador" segue correto.
- **Métrica de baseline**: `totalCandidatos: 0` em 2/2 títulos do fixture RHENUS do teste; o 5566 teria pelo menos um ATENCAO não ancorado.

## 5. Cards Kanban

### [fault-tolerance-1] Alarmar quando o fallback das marcas desliga a sugestão de grupo

- **Problema**
  > Quando `bloqueioRepo.listAtivos` falha, a carteira volta silenciosamente ao 1:1 pré-emenda ADR-0077 e permite confirmar o boleto do grupo para um único título — reintroduzindo o defeito do PRD 2026-10-29. Só há `log.warn`; sem contador nem alarme.

- **Melhoria Proposta**
  > Instrumentar uma métrica/contagem agregada (ex.: `LogService` com `type: BUSINESS_ERROR` quando o fallback é acionado por N execuções consecutivas, ou expor um gauge "sugestao_grupo_desligada"). Alternativa low-cost: subir o `logService.warn` da leitura de marcas para `error` quando o fallback persistir por mais do que um ciclo do cache (30 s). Toca `BoletoSuggestionService.marcasOuNenhuma` e `gruposSugeridos`.

- **Resultado Esperado**
  > Analista/operações detectam o degrade em minutos, não só por reclamação do usuário. Métrica observável: `# log.error sugestao_grupo_desligada`: 0 hoje → > 0 quando o fallback ocorre em dias úteis.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Alarmes de fallback detectados por dia: 0 → ≥ 1 nos dias em que o fallback acontece
  - MTTR do defeito "boleto do grupo aparece 1:1" durante incidente de infra: desconhecido → ≤ 15 min
- **Risco de não fazer**: um incidente de infra sem assinatura em `log.error` pode permitir duplicata de pagamento até a próxima conciliação manual.
- **Dependências**: nenhuma

### [fault-tolerance-2] Capturar `code` do driver nos warns de fallback

- **Problema**
  > `gruposSugeridos` e `marcasOuNenhuma` logam só `err.message`; `code` nativo (pg/axios) some. Dificulta correlacionar o fallback com causas de infra.

- **Melhoria Proposta**
  > Replicar o helper `codigoDoErro` já existente em `BoletoSuggestionService:887-890` nos dois warns do fallback. Toca `BoletoSuggestionService.marcasOuNenhuma`, `BoletoSuggestionService.gruposSugeridos`, `BoletoSuggestionService.dpsLidosOuNenhum`.

- **Resultado Esperado**
  > Logs de fallback carregam `codigoErro` quando aplicável. Métrica observável: % de warns de fallback com `codigoErro`: 0 % → ≥ 50 % (quando a origem é pg/driver).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - % warns com `codigoErro` estruturado: 0 → ≥ 50 %
- **Risco de não fazer**: debugging reativo baseado em `message` apenas; piora MTTR.
- **Dependências**: nenhuma

### [fault-tolerance-3] Preservar `totalCandidatos` para títulos em `GRUPO_SUGERIDO`

- **Problema**
  > Títulos marcados `GRUPO_SUGERIDO` reportam `totalCandidatos: 0` mesmo tendo candidatos ATENCAO no envelope, porque `alocaveis` filtra à força-1 antes de `alocarDesfechos` contar.

- **Melhoria Proposta**
  > Separar duas visões em `alocarDesfechos`: `candidatos` exibidos continuam filtrados (I21v impede confirmar), mas `totalCandidatos` conta `pendentes[i].candidatos.length` (não `alocaveis[i].candidatos.length`). Toca `MotorSugestaoBoleto.alocarDesfechos` e `aplicarGrupoSugerido`.

- **Resultado Esperado**
  > A UI do título `GRUPO_SUGERIDO` pode informar "N candidatos 1:1 disponíveis se o grupo for anulado". Métrica observável: nos títulos de fixture RHENUS, `totalCandidatos`: 0 → > 0 para 5566.

- **Tactic alvo**: — (observabilidade de domínio)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - `totalCandidatos` ≥ número real de candidatos no envelope em todos os testes de `GRUPO_SUGERIDO`
- **Risco de não fazer**: UX ligeiramente opaca; nenhuma consequência financeira.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo estrito ao delta: `MotorSugestaoBoleto.aplicarGrupoSugerido/marcarGrupoSugerido/sugestoesValidas`, novo `CenarioGrupoBoleto.paraMotor1a1`, novos campos em `SugestaoBoleto.ts`, fallback `marcasOuNenhuma`/`gruposSugeridos` em `BoletoSuggestionService`, e refusal 1:1 em `sugestaoConfirmavel`. Comportamento de escrita (transação, locks, cascata do par) é pré-existente — não re-auditado.
- Nenhum P0 encontrado: o delta não introduz dupla gravação, nem silencia erros em caminho de escrita; o único caminho que escreve (`confirmar`) continua anti-TOCTOU e, para o novo caso, só RECUSA (nunca grava decisão espúria).
- Cross-QA: F-fault-tolerance-1 toca Availability (fallback silencioso durante incidente parcial) e Security/Auditability (ausência de evento estruturado de degrade). F-fault-tolerance-2 toca Testability (log sem `code` dificulta cenário de teste reprodutivo).
- Métricas de produção (contagem real de fallbacks) não medíveis localmente — requerem CloudWatch/Grafana (ainda não existem no stack atual).
