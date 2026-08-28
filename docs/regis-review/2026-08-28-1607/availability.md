---
qa: Availability
qa_slug: availability
run_id: 2026-08-28-1607
agent: qa-availability
generated_at: 2026-08-28T16:07:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

Escopo do cenário: o caminho de execução de uma escrita no Conexos (`fin010` permuta,
`com298` remessa, `com299` conciliação, solicitação de numerário, recebimento) num usuário
que **tem** vínculo Conexos cadastrado mas cuja sessão não sobe (`decrypt` falha, ou `login`
no ERP falha). Antes do delta, o `resolveForUser` engolia o erro em três `catch` mudos, caía
no robô, e a execução saía. Depois do delta, cai no robô igual — mas emite `warn` estruturado
e grava, no ledger `*_execucao`, a identidade Conexos realmente usada.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário da plataforma com vínculo Conexos cadastrado (`vinculo != null`) | Credencial Conexos falha em runtime — `SecretCipher.decrypt` lança (chave trocada) **ou** `ConexosService.ensureSid` lança (LOGIN_ERROR, `MAX_SESSIONS`, conta bloqueada) | `ConexosSessionResolver.resolveForUser` no meio de uma request de execução (permuta / remessa / conciliação / SN / recebimento) | Operação normal, sob carga humana (analista clica "Executar") | (a) resolver degrada para o robô SEM lançar; (b) publica `identity = { conexosUsername: <robô>, viaRobo: true }` no `AsyncLocalStorage`; (c) `logService.warn(BUSINESS_WARN, motivo)`; (d) ledger `beginExecution` grava a identidade; (e) escrita no ERP prossegue | MTTR percebido pelo usuário = 0 (não é interrompido). MTTD do incidente (silêncio → warn) esperado: minutos (log estruturado consultável) contra os **meses** que o incidente `MARILYN_MUTAFCI` de 2026-08-25 levou para ser diagnosticado por ausência-de-linha em `conexos_sessions`. |

O cenário complementar (I-2) é **auditabilidade retroativa**: dado um `idempotency_key`,
o operador deve conseguir responder "esta baixa saiu em qual identidade Conexos?" sem abrir
o ERP linha a linha — o ledger passa a carregar `conexos_username` + `conexos_usn_cod`.

## 2. Métricas observadas

Todas as métricas abaixo cobrem **apenas o delta** (`main..HEAD`, 2 commits sobre `617ca3b`),
não o repo inteiro. Métricas do repo inteiro em `_shared-metrics.md`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Casos de fallback silenciosos (`catch {}` sem log / sem métrica) no `ConexosSessionResolver` | **0** (antes: 3) | 0 | ✅ | `git diff main..HEAD -- src/backend/domain/client/ConexosSessionResolver.ts` — os três `catch {}` viraram `catch (error) { await this.avisarDegradacao(...) }` (linhas 100 e 118 do arquivo pós-delta) |
| Casos de fallback silencioso **defensáveis** (job/cron sem request; usuário sem vínculo) | 2 | 2 | ✅ | `ConexosSessionResolver.ts:61-63` (`if (!state) return this.registry.robot()`) e `ConexosSessionResolver.ts:96` (`if (!vinculo) return this.degradarParaRobo(state)`) — decisão explícita em `ontology/business-rules/identidade-execucao-conexos.md` §I-1 |
| Ledgers de execução que persistem `conexos_username` + `conexos_usn_cod` | 5 / 5 | 5 / 5 | ✅ | `git grep -l "conexos_username" src/backend/domain/repository` — `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts`, `RecebimentoExecucaoRepository.ts`, `RemessaExecucaoRepository.ts`, `ConciliacaoExecucaoRepository.ts` |
| Migration `0051` — risco em tabela viva | `ADD COLUMN IF NOT EXISTS` nullable sem DEFAULT | Rewrite-free, idempotente | ✅ | `src/backend/migrations/0051_execucao_identidade_conexos.sql:19-38`. Postgres ≥ 11 faz mudança catalog-only, sem varredura. Validado local (`_shared-metrics.md` §Gates: 2ª execução = no-op) |
| Cobertura de teste dos 4 caminhos de degradação | 4/4 (fora-de-request; sem-vínculo; `decrypt` falha; `login` falha) + 2 casos de publicação de identidade | 4/4 | ✅ | `src/backend/domain/client/ConexosSessionResolver.test.ts:139-259` (blocos `I-1` e `publica a identidade resolvida`) |
| Defesa do path de log dentro do fallback (`try/catch` em torno de `avisarDegradacao`/`degradarParaRobo`) | **0** | 1 (ver F-availability-1) | ⚠️ | `ConexosSessionResolver.ts:100-113` — `await this.avisarDegradacao(...)` está no `catch` da escrita crítica sem `try/catch` próprio; o comentário promete "Nunca lança" mas o código não impõe |
| `LogService.warn` — caminho de escrita | `process.stdout.write(JSON.stringify(...))` (síncrono, in-process) | não-lançável para payload plano | ✅ | `src/backend/domain/service/LogService.ts:19-27` — `data` contém só strings (`platformUsername`, `conexosUsername`, `motivo`, `erro`), sem risco de ciclo em `JSON.stringify`. Custo: hoje é seguro por inspeção; um sink futuro (rede, arquivo) reintroduziria o risco |
| Fail-safe do `ConexosIdentityProvider` fora de request | `currentParams() → { null, null }` | valores nulos, ledger grava NULL | ✅ | `src/backend/domain/client/ConexosIdentityProvider.test.ts:12-16` — teste `fora de request → undefined (o ledger grava NULL = "não capturada", nunca "robô")` |
| Alarme/monitor consumindo o novo `BUSINESS_WARN` | 0 | ≥ 1 (dashboard ou alerta) | ❌ | `grep -rn "BUSINESS_WARN\|business_warn" src/backend infra 2>/dev/null` — nenhum consumidor; ver também `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-5 |
| Dedup / rate-limit do `warn` por credencial-que-não-loga | 0 (1 warn por request degradada) | rate-limit ou métrica com dimensão | ⚠️ | Deliberado (followup F-4), mas em burst = flood: 13 execuções no dia do incidente `MARILYN_MUTAFCI` teriam gerado 13 warns idênticos |
| Gates do delta (`typecheck`, `lint`, `test`, migration local) | Todos verdes; 1493 testes / 0 falha | idem | ✅ | `_shared-metrics.md` §Gates |

> ⚠️ **Não medível localmente**: MTTD/MTTR reais de uma degradação para o robô em produção.
> Requer painel/alerta consumindo o `BUSINESS_WARN` no sink de logs do Render (ou destino
> equivalente). Recomendação: instrumentar uma métrica com dimensão `conexosUsername` e
> `motivo` (ver Card `availability-2`), e derivar MTTD dela.

> ⚠️ **Não medível neste repo**: cobertura de DLQ/SQS, dashboards CloudWatch, health-checks
> multi-tenant, blast radius entre contas AWS. Runtime é Express + Render + Supabase (não
> Lambda), e não há `infra/` — CLAUDE.md §"Estado Atual vs. Alvo". Todas as tactics baseadas
> em infra-alvo estão marcadas como N/A para **este delta**, não como falha do repo.

## 3. Tactics — Cobertura no delta

Escopo: como o delta se posiciona em cada tactic Bass & Clements. Onde a tactic é do repo
como um todo (não deste delta), a coluna Evidência aponta para a linha correspondente do
`_shared-metrics.md` ou remete às seções fora de escopo.

### Detect Faults

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — não há ping novo neste delta; o teste explícito de credencial (`testarVinculo`) já existia | N/A | — |
| Heartbeat | N/A — sem heartbeat de sessão introduzido | N/A | — |
| Monitor | O warn estruturado torna a degradação **observável** (antes: silenciosa); o consumo do warn por alarme ainda não existe (F-availability-3) | ⚠️ parcial | `ConexosSessionResolver.ts:126-146` (`avisarDegradacao`); ausência em `grep BUSINESS_WARN` |
| Timestamp | `LogService` injeta `timestamp: new Date().toISOString()` no envelope de todo warn | ✅ presente | `src/backend/domain/service/LogService.ts:23` |
| Sanity Checking | Ledger grava NULL apenas quando **não há** identidade (fora de request ou identidade não publicada); NUNCA confunde NULL com "robô" — regra explícita na migration | ✅ presente | `src/backend/migrations/0051_execucao_identidade_conexos.sql:11-13`; `ConexosIdentityProvider.ts:29-34` |
| Condition Monitoring | O `motivo` (`decrypt` \| `login`) distingue chave-cifrada-quebrada de credencial-inválida — o operador consegue rotear a causa | ✅ presente | `ConexosSessionResolver.ts:20` (tipo `MotivoDegradacao`) e `.ts:107, 122` (parâmetro `motivo`) |
| Voting | N/A — sem redundância N+1 no path de sessão | N/A | — |
| Exception Detection | Antes: 3 `catch {}` mudos. Depois: 2 `catch (error)` que capturam + reportam; 1 `catch` mantido em `testarVinculo` (é teste síncrono pedido pela UI, não runtime — decisão documentada) | ✅ presente | Diff `ConexosSessionResolver.ts` linhas 97-124 |
| Self-Test | `testarVinculo` roda no `/me/conexos-status` (login) — inalterado neste delta | N/A (fora do delta) | `ConexosSessionResolver.ts:79-89` |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — sem hot-standby de sessão | N/A | — |
| Passive Redundancy | O **robô** é a réplica passiva da sessão do usuário — pré-existia; o delta o torna nomeado explicitamente (`identity.conexosUsername = env.conexosLogin`, `viaRobo: true`) em vez de "implícito por falta de dado" | ✅ presente (reforçado) | `ConexosSessionResolver.ts:118-122` (`degradarParaRobo`) |
| Spare | N/A — sem instância cold-spare | N/A | — |
| Exception Handling | 2 `catch (error)` novos com contexto (`platformUsername`, `conexosUsername`, `motivo`, `erro`) alimentando `LogService.warn` | ✅ presente | `ConexosSessionResolver.ts:97-124` |
| Rollback | `beginExecution` grava com `dry_run` e status write-ahead; `fail()` fecha a linha em `error` sem apagar a identidade (`COALESCE`, ADR-0041) — mecanismo pré-existente, delta preserva | ✅ presente (preservado) | `PermutaExecucaoRepository.ts:328-347`, `ConciliacaoExecucaoRepository.ts:149-158` |
| Software Upgrade | Migration `0051` idempotente e sem rewrite = seguro em blue/green (Render substitui o container após deploy) | ✅ presente | `migrations/0051_execucao_identidade_conexos.sql` |
| Retry | Path de resolução de sessão **NÃO** retenta em `login` fail — cai direto no robô. É a política correta (retentar login inválido só gasta rate-limit do ERP), mas vale registrar que é decisão, não omissão | ✅ presente (decisão explícita) | `ontology/business-rules/identidade-execucao-conexos.md` §"O fallback… é legítimo" |
| Ignore Faulty Behavior | A degradação para o robô é literalmente "ignorar o vínculo quebrado e seguir". Antes: implícita. Depois: **registrada** — a tactic ficou defensável | ✅ presente | `ConexosSessionResolver.ts:118-122` |
| Degradation | Escrita segue no robô em vez de bloquear — decisão de ADR-0041 preservada. O usuário não é interrompido; a operação financeira acontece | ✅ presente | `ontology/business-rules/identidade-execucao-conexos.md` §"O fallback NUNCA bloqueia" |
| Reconfiguration | O contexto `AsyncLocalStorage` reconfigura, por-request, qual sessão está ativa; o delta acrescenta `identity` ao estado (publicação, não decisão) | ✅ presente | `ConexosRequestContext.ts:19-30` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — sem execução em sombra da sessão do usuário para validar antes de promover | N/A | — |
| State Resynchronization | A sessão do usuário será revalidada na próxima request (não há memoização entre requests do resultado `falha`); efetivamente ressincroniza por-request | ✅ presente | `ConexosRequestContext.ts:29` (`resolved` é por-request) |
| Escalating Restart | N/A — não aplicável ao runtime Express monolítico atual | N/A | — |
| Non-Stop Forwarding | N/A — sem plano de dados separado do de controle | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Removal from Service | N/A neste delta — não há "colocar usuário em quarentena" após N falhas de login | N/A (fora de escopo) | — |
| Transactions | Escritas nos ledgers usam SQL parametrizado; a migration é DDL isolada. `beginExecution` + `markSettled` é write-ahead com `ON CONFLICT DO UPDATE`, preservando idempotência | ✅ presente | `PermutaExecucaoRepository.ts:230-259` |
| Predictive Model | N/A — sem previsão de falha de credencial (poderia existir, ver `availability-2`) | N/A | — |
| Exception Prevention | **Gap**. `avisarDegradacao` promete "Nunca lança" no comment mas não impõe (nenhum `try/catch` em torno de `logService.warn` nem do `getEnvironmentVars()` do fallback). Hoje seguro por inspeção; regressão futura no `LogService` (sink de rede, arquivo) reintroduziria o risco no meio da escrita ao ERP — ver F-availability-1 e F-availability-2 | ⚠️ parcial | `ConexosSessionResolver.ts:100, 118-122, 126-146` |
| Increase Competence Set | O `motivo` estruturado + os campos `conexosUsername`/`conexosUsnCod` no ledger aumentam o repertório do operador (agora ele consegue responder "quem assinou?" sem abrir o ERP) | ✅ presente | `identidade-execucao-conexos.md` §"O incidente que originou esta regra…" |

## 4. Findings

### F-availability-1: `avisarDegradacao` promete "nunca lança" mas o código não impõe

- **Severidade**: P2 (débito técnico defensável — seguro hoje por inspeção; regressão futura fica no path crítico)
- **Tactic violada**: Exception Prevention
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:100, 118, 126-146`
- **Evidência (objetiva)**:
  ```typescript
  // ConexosSessionResolver.ts:97-102 — o await está no catch da escrita
  } catch (error) {
      await this.avisarDegradacao(platformUsername, vinculo.conexosUsername, 'decrypt', error);
      return this.degradarParaRobo(state);
  }
  // ...
  // ConexosSessionResolver.ts:126-146 — o método NÃO tem try/catch em torno de logService.warn
  private avisarDegradacao = async (...): Promise<void> => {
      await this.logService.warn({ ... });   // se isto lançar, propaga para resolveForUser → resolve()
  };
  ```
  Auditoria do `LogService.warn` (`domain/service/LogService.ts:19-27`) mostra que hoje ele só faz
  `JSON.stringify(logBody)` + `process.stdout.write(...)`. Para o payload atual (só strings, sem ciclos)
  isso é não-lançável. O comment no método (`Nunca lança (o log não pode derrubar a execução)`) é
  aspiracional — não há barreira estática nem runtime que o garanta.
- **Impacto técnico**: um sink futuro no `LogService` (rede, arquivo, worker) que introduza `throw`
  em `warn` propagaria para `resolveForUser` → `resolve()` → o caller. O caller é o path que resolve
  a sessão **antes** de uma escrita irreversível no `fin010` / SISPAG / conciliação. Uma exceção no
  logger transformaria "credencial ruim → escrita segue pelo robô" em "credencial ruim → escrita
  aborta com erro do logger" — regressão de disponibilidade oculta atrás de uma mudança no
  observability stack, longe do site de uso.
- **Impacto de negócio**: risco de bloquear execuções financeiras (permutas, remessas,
  conciliações) por defeito na camada de log — o oposto explícito da decisão de ADR-0041
  ("Degradar para o robô é preferível a derrubar uma baixa no meio").
- **Métrica de baseline**: 0 `try/catch` defensivos em `avisarDegradacao`; 2 call sites no path
  crítico de escrita (linhas 100, 118 do resolver).

### F-availability-2: `degradarParaRobo` chama `getEnvironmentVars()` sem defesa

- **Severidade**: P2 (mesmo raciocínio de F-1; risco baixo no runtime Express, cresce no alvo Lambda)
- **Tactic violada**: Exception Prevention
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:118-122`
- **Evidência (objetiva)**:
  ```typescript
  private degradarParaRobo = async (state: ConexosRequestState): Promise<ConexosService> => {
      const env = await this.environmentProvider.getEnvironmentVars();   // sem try/catch
      state.identity = { conexosUsername: env.conexosLogin, viaRobo: true };
      return this.registry.robot();
  };
  ```
  `EnvironmentProvider.getEnvironmentVars` (`src/backend/domain/libs/environment/EnvironmentProvider.ts:16-22`)
  é memoizado — no runtime atual (Express + `client_name=local`) resolve-se do `process.env` uma
  vez e depois é O(1). No alvo Lambda (`GetLambdaEnvironmentVars` → SSM), a primeira chamada por
  cold-start pode lançar (SSM indisponível, IAM negado). Aí o **fallback** para o robô — que existe
  justamente para blindar o path crítico — passa a lançar em vez de proteger.
- **Impacto técnico**: mesmo espírito de F-1: uma exceção fora do domínio original (env / SSM)
  aborta uma escrita que a regra de negócio manda seguir pelo robô.
- **Impacto de negócio**: idem F-1; mais visível quando o repo migrar para Lambda (roadmap
  descrito no CLAUDE.md), quando cold-starts e SSM entram na equação.
- **Métrica de baseline**: 1 chamada externa (`getEnvironmentVars`) no path de fallback sem
  `try/catch`; 3 call sites de `degradarParaRobo` (linhas 63, 96, 105 do resolver).

### F-availability-3: nenhum consumidor observa o `BUSINESS_WARN` de degradação

- **Severidade**: P2 (a tactic Monitor fica pela metade — o warn existe, o alarme não)
- **Tactic violada**: Monitor
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:132-145` (emissor); nenhum
  consumidor em `src/backend` ou (ausente) `infra/`.
- **Evidência (objetiva)**:
  ```
  $ grep -rn "BUSINESS_WARN" src/backend | grep -v test | grep -v ConexosSessionResolver
  (nenhum resultado — o único emissor é o próprio resolver)
  ```
  Ver também `ontology/_inbox/conexos-fallback-audit-regis-followups.md` F-5: "Nenhum alarme/painel
  consome o `warn` ainda [...] Este delta fecha a lacuna de **registro**; a de **notificação**
  continua aberta."
- **Impacto técnico**: MTTD (tempo até detectar) de uma nova degradação continua sendo "quando
  alguém for procurar no log". O incidente `MARILYN_MUTAFCI` de 2026-08-25 (35 execuções
  degradadas, 13 num dia só) demoraria menos para ser diagnosticado **se** alguém abrisse o log —
  mas ninguém abre log por conta própria; alarme = push, log = pull.
- **Impacto de negócio**: baixas continuam saindo assinadas pelo robô sem qualquer notificação
  ao time responsável — o incidente 2026-08-25 mostrou que passar meses assim é o modo default.
- **Métrica de baseline**: 0 alertas configurados (o repo não tem `infra/`; não há sink de
  alerta declarado em código).

### F-availability-4: warn sem dedup pode virar flood em burst

- **Severidade**: P3 (nice-to-have; a decisão de emitir 1 warn por request degradada é explícita
  na followup F-4)
- **Tactic violada**: Monitor (excesso de sinal desqualifica o próprio sinal)
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:132-145`
- **Evidência (objetiva)**: o mesmo usuário com o mesmo `motivo` produz N warns idênticos em N
  requests degradadas na mesma janela. Não há estado dedup no resolver, e não deveria haver
  (`@singleton()` cross-request), então o dedup precisaria morar em outro lugar (métrica com
  dimensão, sink com sampling).
- **Impacto técnico**: burst de 13 execuções no dia do incidente = 13 warns idênticos no log,
  todos com o mesmo `platformUsername`/`conexosUsername`/`motivo`. O ruído em produção
  esconde o sinal.
- **Impacto de negócio**: em picos (fechamento de mês, migração de front), o log de warn
  perde utilidade justamente quando é mais necessário para triagem.
- **Métrica de baseline**: 1 warn por request degradada; 0 métricas com dimensão
  `conexosUsername` / `motivo`.

## 5. Cards Kanban

### [availability-1] Blindar `avisarDegradacao` e `degradarParaRobo` contra exceções do path de observabilidade

- **Problema**
  > `ConexosSessionResolver.avisarDegradacao` (linha 126) e `degradarParaRobo` (linha 118)
  > estão no `catch` da escrita ao ERP mas não têm `try/catch` próprio. O comentário promete
  > "Nunca lança (o log não pode derrubar a execução)" — hoje é verdade por inspeção
  > (`LogService.warn` só faz `stdout.write`), mas nada impõe. Um sink futuro que introduza
  > `throw` em `warn`, ou um SSM instável no alvo Lambda, transforma "credencial ruim → escrita
  > segue pelo robô" (decisão de ADR-0041) em "credencial ruim → escrita aborta com erro do
  > logger".

- **Melhoria Proposta**
  > Envolver `logService.warn(...)` em `avisarDegradacao` num `try/catch` que loga o erro do
  > próprio logger em `process.stderr.write` (último recurso, síncrono) e retorna. Envolver o
  > `await this.environmentProvider.getEnvironmentVars()` em `degradarParaRobo` num `try/catch`
  > que degrada mesmo assim (`state.identity = { conexosUsername: 'unknown-robot',
  > viaRobo: true }`; o ledger grava `unknown-robot`, não NULL — e passa a ser marcador
  > distinto de "identidade não capturada"). Tactic Bass alvo: **Exception Prevention**.
  > Adicionar teste que injeta `logService.warn` throwing e `environmentProvider` throwing e
  > verifica que `resolve()` ainda devolve `ROBOT`.

- **Resultado Esperado**
  > Nenhum defeito na camada de observabilidade pode abortar uma escrita ao ERP. "Nunca lança"
  > deixa de ser aspiração e vira invariante testada.
  > Métrica: `catch` defensivos no path de fallback: 0 → 2. Casos de teste que injetam falha
  > no logger e no env: 0 → 2.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1, F-availability-2
- **Métricas de sucesso**:
  - `try/catch` em torno de `logService.warn` no path de escrita: 0 → 1
  - `try/catch` em torno de `environmentProvider.getEnvironmentVars` no fallback: 0 → 1
  - Teste que injeta logger throwing e verifica `resolve() === ROBOT`: ausente → presente
- **Risco de não fazer**: uma mudança futura no `LogService` (sink de rede, `pino`, worker)
  passa despercebida em code review porque o resolver "está seguro"; o próximo incidente é
  uma escrita financeira derrubada pelo logger em vez de protegida pelo fallback — regressão
  de disponibilidade oculta atrás de uma mudança em código de observabilidade.
- **Dependências**: nenhuma.

### [availability-2] Instrumentar alarme sobre `BUSINESS_WARN` com `motivo in (decrypt, login)`

- **Problema**
  > O delta fecha a lacuna de **registro** (`warn` estruturado com `platformUsername`,
  > `conexosUsername`, `motivo`, `erro`) mas não a de **notificação**. Nenhum consumidor lê o
  > log — grep em `src/backend` mostra que o único emissor é o próprio resolver. O incidente
  > `MARILYN_MUTAFCI` de 2026-08-25 (35 execuções degradadas, 13 num dia só, meses sem
  > detecção) prova que ninguém abre log por conta própria: sem push, o warn continua
  > invisível.

- **Melhoria Proposta**
  > Definir um destino declarado para o log (Better Stack / Grafana Loki / Papertrail — Render
  > suporta sink HTTP) e criar um alerta: "1 ocorrência de `type=BUSINESS_WARN` e `data.motivo
  > in (decrypt, login)` em janela de 10min → aviso ao canal de operações Kavex; 5 ocorrências
  > do mesmo `data.conexosUsername` em 24h → escalar para o Yuri". Tactic Bass alvo:
  > **Monitor**. Documentar o alerta em `ontology/integrations/conexos.md` §"Identidade da
  > sessão". Cross-QA: este card se alinha com `fault-tolerance` (Reintroduction: quando a
  > credencial for corrigida no ERP, o warn cessa — a métrica é o próprio sinal de
  > reintrodução).

- **Resultado Esperado**
  > MTTD de uma nova degradação para o robô cai de "meses (foi o caso 2026-08-25)" para
  > minutos-a-horas. O operador é notificado no canal onde já mora, sem precisar abrir log.
  > Métrica: alarmes consumindo o `BUSINESS_WARN`: 0 → ≥1.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — envolve escolher/configurar o sink, definir os thresholds
  com o time, testar sem gerar page fatiga)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Alarmes/regras consumindo `BUSINESS_WARN` com `motivo in (decrypt, login)`: 0 → ≥1
  - MTTD estimado para "usuário com vínculo cai no robô": não medível hoje → < 1h (pelo alerta)
  - Documentação em `ontology/integrations/conexos.md`: ausente → presente
- **Risco de não fazer**: outro incidente análogo ao de 2026-08-25 acontece — o warn agora
  existe, mas passa despercebido pelas mesmas semanas até um usuário reclamar; a inversão
  entre `executado_por` e `conexos_username` no ledger é detectável **por consulta**, mas
  ninguém consulta sem sinal.
- **Dependências**: escolha do sink de log (decisão do Yuri; hoje o Render envia stdout
  apenas para o console interno).

### [availability-3] Rate-limit ou métrica com dimensão para o warn de degradação

- **Problema**
  > O warn sai uma vez por request degradada, sem dedup. Em picos (fechamento de mês, `com298`
  > em lote grande), um único usuário com credencial quebrada pode gerar dezenas de warns
  > idênticos numa janela curta. A followup F-4 já reconhece que a decisão foi deliberada
  > ("sem estado, sem dedup"); o card materializa o próximo passo defendido lá — trocar
  > "warn por request" por "métrica com dimensão".

- **Melhoria Proposta**
  > Emitir uma métrica (contador) `conexos_fallback_degradation_total` com labels
  > `motivo` e `conexosUsername` (bounded — a lista de usuários vinculados é curta). O warn
  > estruturado continua saindo, mas com sampling (ex.: 1 a cada N por credencial-motivo em
  > janela deslizante) — o log serve para diagnóstico, o contador serve para dashboards e
  > alertas. Alternativa mais barata: manter o warn tal-qual mas configurar o alarme do
  > card `availability-2` para agregar por credencial antes de disparar. Tactic Bass alvo:
  > **Monitor** (qualidade do sinal).

- **Resultado Esperado**
  > O sinal (número de execuções que caíram no robô por credencial/motivo) permanece
  > acionável em burst; o log deixa de servir de dashboard e volta a servir de diagnóstico.
  > Métrica: log lines por request degradada: 1 → 1/N (sampled) ou 0 (métrica-como-fonte).

- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — envolve escolher a stack de métricas: hoje o repo não tem
  cliente Prometheus/Datadog)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Warns por credencial-motivo em janela de 1h: sem teto → ≤ configurável (ex.: 5)
  - Métrica `conexos_fallback_degradation_total{motivo, conexosUsername}`: ausente → presente
- **Risco de não fazer**: baixo em regime normal (poucos usuários vinculados = pouco
  volume). O risco cresce se o vínculo Conexos virar padrão de deploy (várias contas ativas
  simultaneamente) — quando o card `availability-2` estiver ligado, o excesso de sinal
  fatiga o canal.
- **Dependências**: `availability-2` deve estar decidido primeiro (o formato do sinal depende
  de onde ele será consumido).

## 6. Notas do agente

- Escopo intencionalmente restrito ao **delta** (`main..HEAD`, 2 commits). Métricas de
  Executors/DLQ/CloudWatch do plano de inspeção A foram calibradas para o repo inteiro no
  `_shared-metrics.md` mas **não** se aplicam a este delta — que é auditoria/observabilidade,
  não introdução de path externo novo. Registrar tactics como `N/A neste delta` foi decisão
  explícita, não omissão.
- Análise do `LogService.warn` foi por inspeção estática (`process.stdout.write` +
  `JSON.stringify` de payload plano). Não rodei o resolver injetando um logger throwing — o
  teste que faria isso é a métrica de sucesso do card `availability-1`, cuja ausência é
  precisamente o finding.
- Cross-QA para o consolidator: cards `availability-2` e `availability-3` tocam Fault
  Tolerance (Detect / Reintroduction) e Security (o `warn` não pode vazar senha — coberto por
  teste explícito em `ConexosSessionResolver.test.ts:196-213`; se o security agent for
  reforçar, esta é a evidência).
- Nenhum comando com efeito colateral rodado — leitura apenas, respeitando o aviso do prompt
  sobre `src/backend/.env` apontar para Supabase de produção compartilhado.
