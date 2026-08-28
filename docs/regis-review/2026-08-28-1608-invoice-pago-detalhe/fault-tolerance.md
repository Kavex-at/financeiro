---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-fault-tolerance
generated_at: 2026-08-28T16:08:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos `com308` (title endpoint) | Falha transiente/parcial (5xx, rede, `titMnyTotPago` ausente) durante ingestão diária | `EleicaoPermutasService.hidratarInvoiceNegociada` + persistência `permuta_invoice` | Ingestão em produção (cron `0 9 * * *` UTC ou trigger manual do analista) | Manter a invoice VISÍVEL na aba "em aberto" (`pago = false` conservador) — nunca esconder algo sem prova de quitação | 0 invoices sumidas da tela sem prova; 100% das falhas parciais rastreáveis pós-run; ingestão marca `status='partial'` quando há degradação |

> Concretamente: das 1146 INVOICEs finalizadas da filial 2 (probe PRD 2026-08-28), a run precisa distinguir "aparece na aba porque *é* em aberto" de "aparece na aba porque `com308` engasgou nela". Hoje as duas viram `pago=false` e ficam indistinguíveis.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `catch` silenciosos (sem `logService.warn/error`) no caminho `pago` da ingestão | 3 | 0 | ❌ | `grep -n "catch" src/backend/domain/service/permutas/EleicaoPermutasService.ts` → linhas 563, 622, 858 (blocos vazios ou `.catch(() => undefined)` na 887) |
| Contador por-run de invoices que caíram no fallback conservador (`pago=false` por falha, não por regra) | 0 (não existe) | 1 métrica publicada em `FLOW_COMPLETE`/`ingest run header` | ❌ | `grep -n "fallback\|conservador" src/backend/domain/service/permutas/EleicaoPermutasService.ts` (só comentários, nenhum log/contador) |
| Coluna `pago_source`/`pago_confiavel` na `permuta_invoice` | 0 (não existe) | 1 coluna que discrimine `com308-titulo` × `fallback-conservador` × `list-row` | ❌ | `grep -rn "pago_source\|pago_confiavel\|fonte_pago" src/backend` → 0 hits |
| Atomicidade da ingestão (UPSERT + markStale + recompute casamento) | 100% em transação única + advisory lock | 100% | ✅ | `PermutaRelationalRepository.ts:193-210` (`persistIngestRun` = `withAdvisoryLock` ∘ `withTransaction`) |
| Idempotency-Key na eleição (`Idempotency-Key` header + `pg_try_advisory_lock`) | 1/1 endpoint mutante da eleição | 1/1 | ✅ | `EleicaoPermutasService.ts:156-216` |
| Direção do fallback documentada no código | 3 sítios documentados (`EleicaoPermutasService.ts:98-102, 623-626`; `AlocacaoPermutasService.ts:~130`) | ≥ 1 | ✅ | Docstring de `derivarPagoDosTitulos` + comentário do `catch` em `hidratarInvoiceNegociada` |
| `IngestRunHeader.status='partial'` acionado quando há falhas parciais | 0 acionamentos (enum declarado, nunca usado) | Emitido sempre que N invoices caíram no fallback | ❌ | `IngestaoPermutasService.ts:91` (só `'success'`), `IngestaoPermutasService.ts:191` (só `'error'`); tipo em `PermutaRelationalRepository.ts:92` |
| Falso alarme diário: cron termina com `exit 1` quando lock ocupado (analista manual em curso) | 1 (comportamento presente) | 0 (contenção esperada não deveria acordar plantão) | ⚠️ | `IngestaoPermutasService.ts:172-179` re-lança `IngestLockBusyError` → `jobs/ingest-permutas.ts:34-40` `console.error` + `process.exit(1)` |
| Reprocessamento (`pago = EXCLUDED.pago` no UPSERT — reverte `true→false` num estorno) | Presente | Presente | ✅ | `PermutaRelationalRepository.ts:358` (`pago = EXCLUDED.pago`) |
| Ground-truth validation contra `getDetalheTitulos` (30/30 concordam) | Presente e commitado no repo | Presente | ✅ | `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts` |

> ⚠️ **Não medível localmente**: taxa REAL de fallback em produção (quantas invoices caem no `catch` do `com308` por dia). Requer instrumentação — hoje não há contador. Recomendação: adicionar `fallbackCount` ao `FLOW_COMPLETE` e ao header da run.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | `derivarPagoDosTitulos` substitui a fonte inservível (`com298/list.mnyTitAberto` null em 1146/1146) pela derivação `Σ titMnyValor − Σ titMnyTotPago === 0` | ✅ presente | `EleicaoPermutasService.ts:103-113`, validação `jobs/validate-invoice-pago-detalhe-v1.ts` |
| Predictive Model | Ausente — não há previsão de "esta invoice vai falhar na hidratação" | N/A | Não aplicável a uma leitura idempotente diária |
| Increase Competence Set | Fallback conservador tratado como parte do contrato (`pago = false` explícito, tornando o valor semanticamente válido em vez de undefined que quebraria a query) | ✅ presente | `EleicaoPermutasService.ts:598, 622-626` |
| Sanity Checking | `derivarPagoDosTitulos` valida: (a) array não vazio, (b) todo título traz `valorBrl` E `valorPago` antes de somar | ✅ presente | `EleicaoPermutasService.ts:106-109` |
| Comparison | Validador `validate-invoice-pago-detalhe-v1.ts` compara `derivarPagoDosTitulos` (`com308`) com `getDetalheTitulos.pago` (`com298/{docCod}`); tolerância = 0 divergências | ✅ presente | `jobs/validate-invoice-pago-detalhe-v1.ts:69-89` |
| Timestamp | `last_seen_at` em cada linha + `updated_at` — permite saber a idade do dado | ✅ presente | `PermutaRelationalRepository.ts:258, 293` |
| Timeout | Herdado do `ConexosBaseClient.runWithRetry` (não tocado no delta) | ✅ presente | `ConexosTitulosClient.ts:187` |
| Condition Monitoring | **Ausente para o fallback do `pago`.** Nenhum contador de "N invoices caíram no fallback" por run — não há como diferenciar uma run 100% saudável de uma run com 30% de fallback silencioso | ❌ ausente | `EleicaoPermutasService.ts:622-626` (catch vazio) |
| Self-Test | `probe-invoice-pago.ts` + `validate-invoice-pago-detalhe-v1.ts` (executáveis com `PROBE_ALLOW_PRD=1`) | ✅ presente | `src/backend/jobs/probe-invoice-pago.ts`, `.../validate-invoice-pago-detalhe-v1.ts` |
| Voting | N/A — a fonte de verdade é única (`com308.titMnyTotPago`); a validação contra `getDetalheTitulos` é comparison de sanidade, não quórum de execução | N/A | — |
| Redundancy | `permuta_invoice` sobrevive à falha da run (UPSERT: last-good permanece); snapshot de eleição escrito separadamente (`persistRun` em `snapshotRepository`) | ✅ presente | `IngestaoPermutasService.ts:123-135` |
| Recovery — Rollback | `withTransaction` engloba UPSERTs + `replaceAutoCasamentos` + `markStale`; qualquer falha reverte tudo — os fatos last-good sobrevivem | ✅ presente | `PermutaRelationalRepository.ts:198-205` |
| Recovery — Reintroduction (State Resync) | Próxima ingestão sobrescreve `pago` via `pago = EXCLUDED.pago` — um estorno reverte `true→false` sozinho | ✅ presente | `PermutaRelationalRepository.ts:358` |
| Idempotent Replay | Eleição idempotente por `Idempotency-Key` + advisory lock; ingestão idempotente por natureza (recomputa do zero via `computeCandidatas`) | ✅ presente | `EleicaoPermutasService.ts:156-216` |
| Compensating Transaction | N/A neste delta — a ingestão é read-only no Conexos (a única escrita é o Postgres local, coberto por ROLLBACK) | N/A | — |
| Reconcile | O próprio validador `validate-invoice-pago-detalhe-v1.ts` é a reconciliação contra o Conexos, mas roda **on-demand** (não agendado) | ⚠️ parcial | `jobs/validate-invoice-pago-detalhe-v1.ts` — sem cron |
| Quarantine | **Ausente para o `pago`.** Uma invoice que caiu no fallback conservador entra na mesma prateleira das legitimamente em-aberto — não há flag/quarentena discriminando as duas | ❌ ausente | `permuta_invoice.pago` é boolean sem qualificador de fonte |
| Escalating Restart | N/A — job single-shot; sem hierarquia de restarts | N/A | — |
| Shadow | N/A | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: `catch` silencioso na hidratação do `pago` — degradação parcial invisível pós-fato

- **Severidade**: P1 (alto — degrada QA mensurável)
- **Tactic violada**: Condition Monitoring, Quarantine
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:622-626` (novo, no delta); espelha o `catch` da linha 563 (`fetchInvoicesBatched`) e o da 858 (`buildCandidata`, adiantamento não-elegível).
- **Evidência (objetiva)**:
  ```typescript
  try {
      const tit = await this.conexosTitulosClient.listTitulosAPagar({ ... });
      ...
      const pagoDosTitulos = derivarPagoDosTitulos(tit);
      if (pagoDosTitulos !== undefined) inv.pago = pagoDosTitulos;
  } catch {
      // com308 indisponível p/ esta invoice — segue sem valor negociado e com
      // `pago` no piso conservador (`false`): a invoice continua visível na aba
      // em vez de sumir sem prova de quitação.
  }
  ```
  Nenhum `logService.warn`, nenhum contador incrementado, nenhum `flowId`/`docCod` registrado. `grep -n "catch" src/backend/domain/service/permutas/EleicaoPermutasService.ts` → linhas 563, 622, 858 confirmam o padrão em 3 sítios.
- **Impacto técnico**: se o `com308` engasgar em N invoices durante uma run (blip de rede, `MAX_SESSIONS`, HTTP 5xx transiente que exceda o retry), essas N linhas são persistidas com `pago=false` e ficam **indistinguíveis** das genuinamente em-aberto. `IngestRunHeader.status` continua `'success'`. Depois do fato, não há como responder "quantas invoices da run X caíram no fallback?" — a evidência foi engolida.
- **Impacto de negócio**: a aba "Invoices em aberto" (que o delta veio corrigir) volta a ser parcialmente confiável — mas agora silenciosamente. Uma invoice que a analista processar como "em aberto" e que já estava paga cria retrabalho + risco de dupla cobrança de crédito ao cliente. Ainda menor que o defeito original (que tinha ~75% de lixo), mas com pior detectabilidade — a analista assume que a aba está confiável.
- **Métrica de baseline**: 3 `catch` sem log no caminho `pago` da ingestão; 0 contadores de fallback; 0 colunas de fonte-do-dado.

### F-fault-tolerance-2: `IngestLockBusyError` no cron vira `exit 1` — falso alarme diário quando analista manual está rodando

- **Severidade**: P1 (alto — degrada operabilidade mensurável)
- **Tactic violada**: Sanity Checking (o job trata contenção esperada como falha)
- **Localização**: `src/backend/jobs/ingest-permutas.ts:32-40` + `src/backend/domain/service/permutas/IngestaoPermutasService.ts:172-179` + `src/backend/domain/errors/IngestLockBusyError.ts:6-15`
- **Evidência (objetiva)**:
  ```typescript
  // IngestaoPermutasService.ts:177-179 — re-lança sem logar
  if (error instanceof IngestLockBusyError) {
      throw error;
  }
  ```
  ```typescript
  // jobs/ingest-permutas.ts:33-40 — TODO error vira exit 1
  main()
      .then(() => process.exit(0))
      .catch((error) => {
          console.error('[ingest-permutas] ingestion FAILED:', ...);
          process.exit(1);
      });
  ```
  A própria docstring de `IngestLockBusyError` diz "**It is NOT a failure**: no data moved, nothing was written" — mas o job trata todo throw igual. Compare com `src/backend/jobs/reaper-sispag-reconciling.ts:27`: *"Exit 0 mesmo achando órfãos: achar é o trabalho, não é falha do job. Exit não-zero só quando o próprio reaper falha (banco fora)."*
- **Impacto técnico**: cenário concreto — analista clica em "Ingerir" às 05:59, ingestão manual leva ~2min; o cron dispara às 06:00 (`0 9 * * *` UTC = 06:00 America/Sao_Paulo), pega o lock ocupado, cai no `catch`, `process.exit(1)`. Render marca o cron como FAILED daquela madrugada. Isto é uma contenção **esperada** por design (o próprio comentário do `render.yaml:94-95` chama isso de "seguro"), mas produz um alerta operacional.
- **Impacto de negócio**: falso alarme diário sensibiliza o time — depois de N dias, alertas legítimos serão ignorados. E o cron desse dia efetivamente **não rodou** (o manual só cobre a filial que o analista escolhe se algum dia houver escopo por filial; hoje cobre tudo, mas o próximo redesenho pode quebrar isso).
- **Métrica de baseline**: 1 caminho de exit≠0 para contenção esperada; sibling `reaper-sispag-reconciling.ts` explicitamente resolve isto com exit=0 + `logService.warn`.

### F-fault-tolerance-3: `IngestRunHeader.status='partial'` declarado no tipo mas nunca emitido

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Sanity Checking (o registro de auditoria mente sobre a saúde da run)
- **Localização**: `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:92` (tipo) × `src/backend/domain/service/permutas/IngestaoPermutasService.ts:91, 187` (só `'success'`/`'error'`)
- **Evidência (objetiva)**:
  ```typescript
  // repository — o tipo prevê 3 estados
  status: 'success' | 'partial' | 'error';
  ```
  `grep -n "status:.*'partial'" src/backend/domain/service/permutas/` → nenhum hit no service. A run só é `success` (linha 91) ou `error` (linha 187).
- **Impacto técnico**: um run com N invoices no fallback conservador (F-fault-tolerance-1) é gravado como `status='success'`. Auditoria posterior não distingue "run limpa" de "run degradada".
- **Impacto de negócio**: retrospectivas ficam cegas. "Por que a aba estava suja no dia X?" — não há como responder olhando `permuta_eleicao_run`.
- **Métrica de baseline**: 0 runs com `status='partial'` possíveis nos caminhos atuais; enum ⅓ ocioso.

### F-fault-tolerance-4: sem coluna `pago_source`/`pago_confiavel` — recuperação depende de bom-comportamento futuro, não é auditável

- **Severidade**: P2 (médio — débito técnico defensável)
- **Tactic violada**: Quarantine (fontes distintas do mesmo campo devem ser separáveis)
- **Localização**: `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:45-64` (tipo `InvoiceRow`) — sem coluna de fonte. `grep -rn "pago_source\|pago_confiavel\|fonte_pago" src/backend` → 0 hits.
- **Evidência (objetiva)**: hoje `permuta_invoice.pago boolean` armazena indistintamente:
  - `true` derivado de `Σ face === Σ pago` no `com308` (fonte confiável — a que o delta introduziu);
  - `false` derivado da mesma soma (fonte confiável);
  - `false` do fallback conservador porque `com308` engasgou (não confiável);
  - `false` do piso porque o título não trazia `valorPago` (não confiável).
  Todos os quatro casos ficam no mesmo booleano.
- **Impacto técnico**: a mitigação "a próxima ingestão conserta" (`pago = EXCLUDED.pago`) só funciona se o `com308` voltar a responder para aquela linha específica. Se o `com308` estiver *seletivamente* indisponível para uma família de docs (ex.: um `docCod` corrompido no ERP), a linha fica *permanentemente* no fallback sem sinal — o analista assume que está em-aberto de verdade.
- **Impacto de negócio**: sem coluna de fonte, o time não consegue construir um dashboard "quantas invoices atualmente na aba caíram no fallback nas últimas N runs" — a métrica operacional mais importante para essa aba é literalmente incalculável do banco.
- **Métrica de baseline**: 0 colunas discriminadoras; 4 origens do mesmo booleano.

### F-fault-tolerance-5: fallback direcional documentado e consistente entre callsites — sanity check positivo, sem card

- **Severidade**: P3 (baixo — observação positiva)
- **Tactic aplicada**: Increase Competence Set + Sanity Checking (direção do fallback consistente e explicitamente justificada)
- **Localização**: `EleicaoPermutasService.ts:98-102, 623-626`; `AlocacaoPermutasService.ts:~130`; `EleicaoPermutasService.ts:733` (`pago: detalhe.pago ?? false` no adto)
- **Evidência (objetiva)**: nos 3 sítios a decisão "na dúvida, MANTÉM visível" é: (a) implementada de forma consistente, (b) documentada com a razão de domínio ("esconder tira dinheiro do radar da analista; mostrar apenas incomoda"), (c) coberta por teste (`EleicaoPermutasService.test.ts:1044-1053` "com308 indisponível → pago:false"). Isto é o oposto de "silent choice by omission".
- **Impacto**: nenhum — é a evidência de que a direção do fallback é uma decisão de arquitetura, não um acidente. Nenhum card necessário; mencionado aqui só para o consolidator distinguir "silencioso e não-intencional" (F-1) de "silencioso mas direcionalmente correto" (F-5).
- **Métrica de baseline**: 3/3 callsites com fallback conservador na mesma direção; 1/1 teste unitário cobrindo o caminho de exceção.

## 5. Cards Kanban

### [fault-tolerance-1] Instrumentar o fallback conservador de `pago` — contador + log + coluna de fonte

- **Problema**
  > Quando o `com308` falha para uma invoice durante a ingestão (`EleicaoPermutasService.ts:622-626`), a linha é persistida com `pago=false` e fica indistinguível das legitimamente em-aberto. O `catch` é vazio (sem `logService.warn`), o header da run continua `'success'`, e não há coluna que registre a fonte do `pago`. Pós-fato é impossível responder "quantas invoices caíram no fallback na run de ontem?".

- **Melhoria Proposta**
  > Aplicar **Condition Monitoring** e **Quarantine** (Bass) em três frentes no mesmo commit: (1) trocar o `catch {}` por `catch (err) { fallbackCount++; await this.logService.warn({ type: BUSINESS_WARN, message: 'invoice pago fallback', data: { flowId, filCod, docCod: raw.docCod, err } }) }` nos três sítios (linhas 563, 622, 858 de `EleicaoPermutasService.ts`); (2) propagar `fallbackCount` até `IngestaoResult` e emitir no `FLOW_COMPLETE` + `IngestRunHeader`; (3) migration adicionando `permuta_invoice.pago_source text CHECK (pago_source IN ('titulo','fallback'))`. A vista `WHERE NOT stale AND NOT pago` continua igual; o operador ganha visibilidade sem mudar comportamento.

- **Resultado Esperado**
  > Depois da run, `SELECT count(*) FROM permuta_invoice WHERE last_ingest_run_id=$X AND pago_source='fallback'` responde a pergunta em O(1). Contador `invoicesPagoFallback` presente em 100% dos `FLOW_COMPLETE`.

- **Tactic alvo**: Condition Monitoring + Quarantine
- **Severidade**: P1
- **Esforço estimado**: M (2–3d — 3 catches + migration + adaptação do repository/service + teste)
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Catches silenciosos no caminho `pago`: 3 → 0
  - Contador de fallback publicado em `FLOW_COMPLETE`: ausente → presente
  - Coluna discriminadora de fonte em `permuta_invoice`: ausente → presente
- **Risco de não fazer**: em 6 meses, uma degradação silenciosa do `com308` (ex.: nova versão do ERP com timeout mais agressivo) reintroduz o defeito original que este delta corrigiu — mas dessa vez sem que ninguém veja, porque o header continua dizendo `success`. A Simone descobre de novo por relato de campo.
- **Dependências**: nenhuma

### [fault-tolerance-2] Cron da ingestão distingue "lock ocupado" de "falha real" — exit 0 + warn, não exit 1

- **Problema**
  > O cron `financeiro-ingest-permutas` roda às 06:00 America/Sao_Paulo. Se o analista tiver disparado uma ingestão manual às 05:59 (ela demora ~1-2min), o cron encontra o `INGEST_LOCK_KEY` ocupado, `IngestaoPermutasService.executar` re-lança `IngestLockBusyError` sem logar (`IngestaoPermutasService.ts:177-179`), e o `.catch` do job (`jobs/ingest-permutas.ts:34-40`) faz `console.error` + `process.exit(1)`. Render reporta o cron como FAILED. A própria docstring do `IngestLockBusyError` chama esse caso de "**NOT a failure**", mas o job não sabe. Falso alarme diário provável.

- **Melhoria Proposta**
  > No `jobs/ingest-permutas.ts`, tratar `IngestLockBusyError` como caso especial: `logService.warn` + `process.exit(0)` (não é falha do job, é contenção esperada). Espelha o padrão de `jobs/reaper-sispag-reconciling.ts:27` — *"Exit 0 mesmo achando órfãos: achar é o trabalho"*. Manter `exit(1)` para todo o resto (banco fora, Conexos fora, código quebrado). Aplicar **Sanity Checking** (Bass) no gatilho do job.

- **Resultado Esperado**
  > Cron nunca é marcado como FAILED por causa de contenção com manual. Falha real (Conexos fora, DB fora) continua acordando o plantão. Log warn permanece para retrospectiva.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P1
- **Esforço estimado**: S (≤0.5d — 5 linhas de código + 1 teste)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Caminhos exit≠0 para contenção esperada: 1 → 0
  - Cobertura de teste do caminho `IngestLockBusyError` no job: 0 → 1
- **Risco de não fazer**: em 6 meses, o time normaliza "cron da permuta falha às vezes" — quando o cron realmente falhar por bug (banco fora, Conexos fora), o alerta será ignorado como ruído.
- **Dependências**: nenhuma

### [fault-tolerance-3] Ingestão emite `status='partial'` quando N invoices caem no fallback

- **Problema**
  > O tipo `IngestRunHeader.status` (`PermutaRelationalRepository.ts:92`) declara `'success' | 'partial' | 'error'`, mas o service só emite `'success'` (linha 91 de `IngestaoPermutasService.ts`) ou `'error'` (linha 187). Uma run com 30% das invoices no fallback conservador é gravada como `'success'` — auditoria mente sobre a saúde da run.

- **Melhoria Proposta**
  > Depois de calcular `fallbackCount` (card `fault-tolerance-1`), setar `header.status = fallbackCount > 0 ? 'partial' : 'success'`. Adicionar `error_message` opcional no status `'partial'` com o padrão `"N invoices caíram no fallback conservador"`. Zero impacto no fluxo de leitura (`listInvoicesEmAberto` filtra por `NOT pago`, não por status da run).

- **Resultado Esperado**
  > `SELECT status, count(*) FROM permuta_eleicao_run WHERE kind='ingest' GROUP BY status` distingue as três realidades. Dashboards conseguem alertar em `partial > 0`.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤0.5d — depende do card 1)
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-1
- **Métricas de sucesso**:
  - Enum `partial` acionado: 0 → ≥ 0 (i.e., passa a ser possível)
  - Runs auditáveis por status real: parcial → completa
- **Risco de não fazer**: mesmo risco de F-1 amplificado — a evidência que existiria (o contador) some quando a run é rotulada como `success`.
- **Dependências**: `fault-tolerance-1` (o contador de fallback é insumo)

### [fault-tolerance-4] Agendar o `validate-invoice-pago-detalhe-v1` como reconciliação semanal

- **Problema**
  > O validador foi commitado (`jobs/validate-invoice-pago-detalhe-v1.ts`) e provou 30/30 concordância contra o `getDetalheTitulos` no dia da correção. Mas roda **on-demand** com `PROBE_ALLOW_PRD=1`. Se o `com308` mudar de comportamento (nova versão do ERP muda o significado do `titMnyTotPago`, ou o `titVldStatus#EQ '1'` passa a filtrar um subconjunto diferente), a divergência só aparece por relato — não há Comparison (Bass) ativa.

- **Melhoria Proposta**
  > Adicionar um segundo cron em `render.yaml` (ou GitHub Actions, seguindo o padrão do `reaper-sispag-reconciling.yml`) que rode `validate-invoice-pago-detalhe-v1.ts` uma vez por semana num sábado noturno (baixo tráfego no ERP). Exit 0 quando 0 divergências (job funcionando); exit 1 apenas em divergência real (o script já faz isso, `linha 100`).

- **Resultado Esperado**
  > A reconciliação vira uma verificação contínua. A janela entre "regra quebrou" e "alguém percebe" cai de "quando a Simone relatar" para "no máximo 7 dias".

- **Tactic alvo**: Comparison + Reconcile
- **Severidade**: P2
- **Esforço estimado**: S (≤0.5d — adicionar bloco `type: cron` no `render.yaml` + doc)
- **Findings relacionados**: F-fault-tolerance-1 (mesma família — visibilidade de degradação)
- **Métricas de sucesso**:
  - Cadência da reconciliação: on-demand → semanal
  - Janela `regra quebra → alguém sabe`: indefinida → ≤ 7d
- **Risco de não fazer**: o próximo `invoice-pago-detalhe` (outro campo do wire que ninguém sabe que virou inservível) só aparece por relato de campo — mesmo defeito de classe do bug que este delta corrigiu.
- **Dependências**: nenhuma (validator já existe e é read-only)

## 6. Notas do agente

- Escopo do delta é estreito (uma função + um cron + um probe + um validator), então foquei em como a nova função *falha bem*: F-1 e F-3 são a mesma família de gap (silêncio na degradação parcial), F-2 é uma dor operacional imediata do cron novo, F-4 é a manutenção da invariante.
- Coisa boa que o delta traz e vale registrar mesmo sem card (F-5): a direção do fallback é consistente entre 3 callsites e explicada em docstring — é o modelo a seguir; o problema não é a decisão, é a falta de instrumentação em volta dela.
- **Cross-QA para o consolidator**: (a) F-1/F-3/F-4 conectam com **Testability** (o `validate-invoice-pago-detalhe-v1` é um teste de produção; agendá-lo é parte de testabilidade contínua); (b) F-2 conecta com **Deployability** (o cron novo é o gatilho); (c) o padrão de fallback conservador conecta com **Modifiability** — quem mexer aqui precisa da mesma disciplina (mostrar > esconder), e a coluna `pago_source` do card 1 é o mecanismo mecânico dessa disciplina.
- Não medi `MTTR real do fallback` — requer produção. O card 1 cria a métrica que torna isso medível.
