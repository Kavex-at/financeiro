---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-28-1607
agent: qa-fault-tolerance
generated_at: 2026-08-28T17:35:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário com vínculo Conexos quebrado (credencial inválida, chave `CONEXOS_CRED_ENC_KEY` ausente/trocada, ou conta bloqueada) executando uma baixa/permuta/remessa | Sessão do usuário falha em `ensureSid`/`decrypt`; resolver degrada para o robô no meio da request | `ConexosSessionResolver` + 5 ledgers write-ahead (`permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao`) | Operação normal, retry ativo | (i) a escrita no ERP CONCLUI pelo robô (não interrompe); (ii) o par `(conexos_username, conexos_usn_cod)` da sessão que assinou é gravado atômico com o `beginExecution`; (iii) invariante `settled` terminal é preservada em toda concorrência/retry; (iv) um `warn` estruturado sai por request degradada | Zero baixas silenciosas atribuídas ao usuário errado; zero regressão de linha `settled`; 100% dos 5 repositórios adotam o **mesmo** guard de status (mirror do `executado_por`); MTTD de vínculo quebrado cai de meses (o incidente 2026-08-25 levou 35 execuções para ser diagnosticado por ausência de linha em `conexos_sessions`) para minutos (primeiro `warn` no stdout).

> Referência: ADR-0041, `ontology/business-rules/identidade-execucao-conexos.md`, `ontology/business-rules/idempotencia-reconciliacao.md`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ledgers write-ahead que persistem identidade do ERP na Fatia B (delta) | **5/5** (`permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao`, `remessa_execucao`, `conciliacao_execucao`) | 5/5 na fatia declarada pela ADR-0041 | ✅ | `src/backend/migrations/0051_execucao_identidade_conexos.sql` + 5 repos |
| Ledgers write-ahead do repo que persistem identidade do ERP (universo total) | **5/6** — `solicitacao_numerario` (permutas, `NumerarioExecucaoRepository`) NÃO recebe as colunas | 6/6 quando `CONEXOS_WRITE_ENABLED` for religado para o fluxo de 3 telas | ⚠️ | `src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts:97-127`, `src/backend/migrations/0032_solicitacao_numerario.sql` |
| Consistência do guard `settled`-terminal para as 2 novas colunas | **5/5** repos usam `CASE WHEN <table>.status = 'settled' THEN <table>.conexos_username ELSE EXCLUDED.conexos_username END` — mirror byte-a-byte do guard existente de `executado_por` | 5/5 | ✅ | `grep "CASE WHEN.*status = 'settled'" src/backend/domain/repository/**/*.ts` (linhas 246, 595, 928, 1124, 1357 do dump agregado) |
| Consistência do first-identity-wins nos terminais (`markSettled`/`markError`/`settle`/`fail`) | **5/5** repos usam `COALESCE(conexos_username, $conexosUsername)` | 5/5 | ✅ | mesmos arquivos, linhas 311/338, 800/827, 980/1001, 1208/1230, 1396/1416 |
| Ordem de escritas (write-ahead → POST → mark) alterada pelo delta | **Não** — o delta acrescenta colunas e params, não muda a sequência de `beginExecution` / `setDocCod` / `setBorCod` / `markSettled` / `markError` | Inalterada | ✅ | `git diff main..HEAD -- src/backend/domain/repository/` — só linhas `INSERT`/`ON CONFLICT`/`UPDATE` recebem colunas novas |
| Suíte de testes que exercita as 5 repositórios com identidade publicada | 6 arquivos de teste atualizados, **1493 tests pass / 0 fail** | verde | ✅ | `docs/regis-review/2026-08-28-1607/_shared-metrics.md` — gate `npm test` |
| Cobertura de teste do path degradado-com-warn no resolver | 3 cenários no `ConexosSessionResolver.test.ts` (decrypt falha, login falha, teste-de-vínculo não loga) + verificação de não-vazamento de senha | ≥3 cenários por motivo distinto | ✅ | `src/backend/domain/client/ConexosSessionResolver.test.ts:140-225` |
| Cobertura de teste do `ConexosIdentityProvider` fora-de-request / sem-identidade / robô | 4 casos (fora de request, sem identidade publicada, usnCod tardio, robô-pelo-nome) | 4 | ✅ | `src/backend/domain/client/ConexosIdentityProvider.test.ts:12-72` |
| Path do `logService.warn` protegido contra falha (I-1 não pode derrubar a escrita) | **Não** — `avisarDegradacao` faz `await logService.warn(...)` sem try/catch; qualquer throw sobe para `resolveForUser` e daí para `resolve()`, abortando a request de escrita | Log jamais deve derrubar caminho de escrita financeira (Bass: Sanity Checking no ponto de degradação) | ⚠️ | `src/backend/domain/client/ConexosSessionResolver.ts:130-149` |
| Reaper de linhas `reconciling`-paradas nos 5 ledgers | **2/5** (`remessa_execucao` e `conciliacao_execucao` expõem `listReconcilingParadas`; `permuta_alocacao_execucao`, `solicitacao_numerario_execucao`, `recebimento_execucao` não têm equivalente) | 5/5 | ⚠️ | `grep "listReconcilingParadas" src/backend/domain/repository/**/*.ts` — **preexistente, não introduzido pelo delta** — flag para o consolidator/Availability |
| Backfill de identidade para linhas anteriores à migration `0051` | **Não** (dívida assumida pela ADR-0041 — a identidade histórica não está gravada em lugar nenhum e inferi-la seria palpite) | não aplicável | ✅ (assumido) | `ontology/decisions/0041-*.md` §Alternativas + §Consequências |
| Métrica ou alarme consumindo os `warn` de I-1 (`type: BUSINESS_WARN`, `motivo in {decrypt, login}`) | **Ausente** — o `warn` cai no `process.stdout` do container Render e não vira alerta | Alerta ativo por `motivo` × `conexosUsername`, com dedup temporal | ⚠️ | `src/backend/domain/service/LogService.ts:29`; F-5 dos followups |
| Atomicidade DB + ERP em qualquer path do delta | Sem novo dual-write. As duas colunas viajam junto do INSERT/UPDATE já existente — não abrem nova janela de inconsistência | inalterada | ✅ | inspeção manual do diff |

⚠️ **Não medível localmente**: taxa real de fallback em produção (quantas requests por hora caem em `motivo=login` vs `motivo=decrypt`). Requer agregação sobre o stream do Render. Recomendação: enquanto F-5 não é fechado, o `qa-observability` deveria contar as linhas `BUSINESS_WARN` num painel simples do Render.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Sanity Checking** | `ConexosSessionResolver.avisarDegradacao` valida shape do erro (`error instanceof Error ? error.message : String(error)`) antes de logar. Nunca inclui senha (teste explícito). | ✅ presente | `ConexosSessionResolver.ts:143-151`; test `ConexosSessionResolver.test.ts:184-199` |
| **Condition Monitoring** | I-1 emite `warn` estruturado (`type: BUSINESS_WARN`) exatamente na condição "vínculo presente + falha em decrypt/login". Sem vínculo e sem request seguem mudos (deliberado, evita ruído). | ✅ presente | `ConexosSessionResolver.ts:130-149`; `identidade-execucao-conexos.md` §I-1 |
| **Timestamp** | `atualizado_em = now()` em toda transição dos 5 ledgers. Colunas `conexos_username`/`conexos_usn_cod` viajam junto (mesmo `UPDATE`). | ✅ presente | `PermutaExecucaoRepository.ts:250,314,340` (idem 4 outros repos) |
| **Timeout** | Não tocado pelo delta. Timeouts do axios do `ConexosService` seguem herdados. | N/A no escopo | — |
| **Voting** | Não aplicável — o resolver escolhe uma sessão, não vota. | N/A | — |
| **Self-Test** | `testarVinculo` é o self-test explícito (login isolado, sem lado de escrita, sem log). O aviso ao usuário vive no `/me/conexos-status`. | ✅ presente | `ConexosSessionResolver.ts:73-91` |
| **Redundancy (Warm Spare / Substitution)** | O robô é o warm spare da identidade — 4 causas de degradação convergem para ele sem interromper a operação. O delta preserva 100% dessa política. | ✅ presente | `ConexosSessionResolver.ts:107-129`; ADR-0041 §Decisão |
| **Rollback** | Não aplicável — a escrita no ERP é irreversível-por-nós (`fin010` estorno manual). Doutrina "forward recovery" da `idempotencia-reconciliacao.md`. | N/A (por design) | `idempotencia-reconciliacao.md` §Recuperação |
| **Idempotent Replay** | `beginExecution` de todos os 5 repos preserva `status='settled'` no `ON CONFLICT`. O delta ESTENDE o mesmo guard para `conexos_username`/`conexos_usn_cod` (mirror do `executado_por`), fechando o único gap possível. | ✅ presente e reforçada | 5 blocos `CASE WHEN <table>.status = 'settled'` — 100% consistentes |
| **Repair State (COALESCE)** | Terminais (`markSettled`/`settle`/`markError`/`fail`) usam `COALESCE(conexos_username, $conexosUsername)` — se a identidade não estava no write-ahead (sessão ainda não resolvida em dry-run/early-fail), o terminal a preenche; se já estava, preserva. | ✅ presente | `PermutaExecucaoRepository.ts:308-312, 334-339` (idem 4 repos) |
| **Reintroduction — State Resync** | O reaper `listReconcilingParadas` existe em Remessa e Conciliação (preexistente); o delta não adicionou nem removeu. Ledgers de permuta/SN-recebimentos/recebimento **ainda não têm** equivalente. | ⚠️ parcial (fora do escopo do delta, cross-QA com Availability) | `RemessaExecucaoRepository.ts:1152-1163`, `ConciliacaoExecucaoRepository.ts:1319-1330` |
| **Quarantine** | `status='error'` é o quarantine per-linha. `markError`/`fail` gravam `erro_mensagem` + `erp_response` cruas, agora com identidade. | ✅ presente | 5 métodos `markError`/`fail` |
| **Reconcile (audit trail)** | As duas colunas fecham a lacuna crítica: "esta baixa saiu no nome de quem?" vira consulta ao ledger (não mais arqueologia de `conexos_sessions`). | ✅ novo — o achado principal desta ADR | `identidade-execucao-conexos.md` §I-2 |
| **Increase Competence Set** | O `warn` distingue `decrypt` vs `login` — leva a triagem para a causa certa (chave trocada vs senha errada/limite de sessões). | ✅ presente | `ConexosSessionResolver.ts:20, 145` |
| **Predictive Model** | N/A — a política é reativa (degrada + loga), não preditiva. | N/A | — |
| **Compensating Transaction** | Não aplicável — o ERP não expõe undo transacional; escrita irreversível-por-nós. | N/A (por design) | `idempotencia-reconciliacao.md` §Recuperação |

## 4. Findings (achados)

### F-fault-tolerance-1: 6º ledger `solicitacao_numerario` (permutas SN 3-telas) fora da migration `0051` — mesmo resolver, mesmo ponto cego

- **Severidade**: P2 (mitigado por o fluxo estar em dry-run neste momento, mas latente: qualquer religamento futuro reabre o buraco que a ADR-0041 fechou)
- **Tactic violada**: Reconcile (audit trail) — cobertura incompleta
- **Localização**: `src/backend/domain/repository/permutas/NumerarioExecucaoRepository.ts` (tabela `solicitacao_numerario`, migration `0032`) — não recebeu as colunas em `0051` e não foi tocado pelo delta.
- **Evidência (objetiva)**:
  ```sql
  -- migration 0051 altera 5 tabelas, mas NÃO altera `solicitacao_numerario`:
  ALTER TABLE permuta_alocacao_execucao ADD COLUMN IF NOT EXISTS conexos_username TEXT, ...
  ALTER TABLE solicitacao_numerario_execucao ...
  ALTER TABLE recebimento_execucao ...
  ALTER TABLE remessa_execucao ...
  ALTER TABLE conciliacao_execucao ...
  -- ausente: ALTER TABLE solicitacao_numerario ...
  ```
  E `NumerarioExecucaoRepository` (permutas) segue **sem** `@inject(ConexosIdentityProvider)`, o `INSERT INTO solicitacao_numerario` (linha 97) não carrega as duas colunas novas.
- **Impacto técnico**: se `CONEXOS_WRITE_ENABLED=true` for religado para o fluxo de 3 telas (o serviço `GerarSolicitacaoNumerarioService` avisa que está parado só por dependências resolvíveis), toda SN escrita via essa trilha degradará silenciosamente ao robô sem deixar rastro no ledger — exatamente o cenário que o incidente 2026-08-25 expôs, replicado num flow paralelo.
- **Impacto de negócio**: uma SN escrita no ERP em nome do usuário errado, sem consulta possível ao ledger para responder "quem assinou?" — a mesma auditoria que a Columbia acabou de exigir.
- **Métrica de baseline**: 5/6 ledgers cobertos = 83%. Alvo declarado pela ADR-0041 ("cinco ledgers, não só o da permuta"): 100% dos ledgers que escrevem no Conexos.

### F-fault-tolerance-2: `logService.warn` awaited dentro do catch sem try/catch — um erro no logger derruba a escrita

- **Severidade**: P3 (probabilidade baixa: `LogService.warn` só escreve `process.stdout.write(JSON.stringify(...))` de payload tipado, sem I/O externo e sem structured clone circular; risco real ~ EPIPE do stdout do container)
- **Tactic violada**: Sanity Checking (o próprio caminho de detecção não é defensivo contra falha dele mesmo)
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.ts:110-124` (branches `catch (error)` em `resolveForUser`), invocando `avisarDegradacao` (linhas 130-149) com `await logService.warn(...)`.
- **Evidência (objetiva)**:
  ```typescript
  try { password = await this.secretCipher.decrypt(vinculo.conexosPasswordEnc); }
  catch (error) {
      await this.avisarDegradacao(platformUsername, vinculo.conexosUsername, 'decrypt', error);
      return this.degradarParaRobo(state);
  }
  // ...
  private avisarDegradacao = async (...): Promise<void> => {
      await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, ... });   // ← sem try/catch
  };
  ```
- **Impacto técnico**: se `process.stdout.write` lançar (stdout fechado / broken pipe / OOM ao serializar), a exceção sobe por `avisarDegradacao` → `resolveForUser` → `resolve()` → aborta a request de escrita financeira. A tactic Reintroduction (fallback para o robô) fica *bypassada* pelo próprio caminho de observabilidade.
- **Impacto de negócio**: um bug no logger vira indisponibilidade de baixa/remessa/conciliação. Trocaria "fallback silencioso" (o problema original) por "fallback com log que se transforma em queda dura" — o pior dos dois mundos.
- **Métrica de baseline**: 0 testes cobrem "warn lança → resolver ainda cai no robô". Alvo: ≥1 teste + wrapping.

### F-fault-tolerance-3: semântica "first-identity-wins" nos terminais pode preservar a identidade de uma tentativa INTERROMPIDA em vez da que efetivamente CONCLUIU

- **Severidade**: P3 (design tradeoff documentado nos comentários do código; sem impacto observado, mas merece verdict explícito)
- **Tactic violada**: Reconcile — a coluna `conexos_username` promete "identidade da sessão que ASSINOU a escrita"; sob retry com identidades distintas, a promessa é ambígua.
- **Localização**: `markSettled`/`markError` das 5 repos, cláusula `COALESCE(conexos_username, $conexosUsername)`.
- **Evidência (objetiva)**:
  ```
  Cenário: baixa retriada com identidade DIFERENTE
    t0  beginExecution(user='SIMONE')  → INSERT ... conexos_username='SIMONE'
    t1  POST /gravarBaixa → timeout    (ERP eventualmente registra a baixa OU não — desconhecido)
    t2  markError                       → COALESCE preserva 'SIMONE' ✓
    t3  beginExecution(user='ROBO')    → ON CONFLICT: status='error' (não settled) → EXCLUDED sobrescreve → 'ROBO'
    t4  POST /gravarBaixa → 200 OK
    t5  markSettled(robo)               → COALESCE preserva 'ROBO' ✓
  ```
  A linha final atribui a baixa a `ROBO`, mas **se a tentativa t1 tiver de fato executado no ERP** (timeout do cliente com sucesso no servidor), o ERP registrou `SIMONE`. Nosso ledger discorda do ERP.
- **Impacto técnico**: a auditoria promete "esta baixa saiu no nome de X"; num caso de retry após timeout-com-sucesso-oculto, o ledger e o ERP divergem. O incidente que motivou a ADR (`MARILYN_MUTAFCI`) tem exatamente essa forma inversa — o ERP registrando robô, o ledger sem informação.
- **Impacto de negócio**: baixo — o cenário exige um retry manual pós-timeout no exato momento em que o ERP silenciosamente aceitou o primeiro POST. A doutrina da `idempotencia-reconciliacao.md` já manda checar `fin010` antes de retry em `reconciling`, o que mitiga.
- **Verdict** (pedido explícito): a semântica "última tentativa de write-ahead ganha para não-settled; primeira gravação no terminal ganha" é **correta para o caso comum** (retry pela mesma pessoa) e **honesta sobre a limitação** para o caso incomum (retry por identidade diferente após timeout com sucesso oculto). Documentar a semântica no `identidade-execucao-conexos.md` e endereçar o caso raro via a checagem obrigatória de `fin010` antes de retry (que já é doutrina).
- **Métrica de baseline**: 0 testes com "retry por identidade diferente após timeout". Alvo: ≥1 teste que fixa a semântica explicitamente.

### F-fault-tolerance-4: `warn` de I-1 sem alarme/painel consumidor — MTTD depende de operador varrer stdout

- **Severidade**: P2 (fecha metade do problema — o registro; não fecha a notificação)
- **Tactic violada**: Condition Monitoring — presente mas sem consumer
- **Localização**: `LogService.warn` → `process.stdout.write` do container Render.
- **Evidência (objetiva)**: F-5 dos followups da própria feature: "Nenhum alarme/painel consome o `warn` ainda". `grep -rn "BUSINESS_WARN" src/backend/monitoring/ src/backend/jobs/` → vazio.
- **Impacto técnico**: o vínculo quebrado da próxima `MARILYN_MUTAFCI` só aparece se um operador acompanhar o stdout do Render em tempo real — o que ninguém faz. A ADR promete "próxima ocorrência em minutos, não em meses"; sem alarme, a promessa depende de disciplina humana.
- **Impacto de negócio**: MTTD real de vínculo quebrado permanece indeterminado até o alarme existir. Vale como P2 porque a auditoria retroativa (via ledger) já é possível — a lacuna é sobre notificação preventiva.
- **Métrica de baseline**: 0 consumidores. Alvo: 1 painel/alarme filtrando `type=BUSINESS_WARN AND data.motivo IN (decrypt, login)`, com dedup por `conexosUsername` × dia.

### F-fault-tolerance-5: reaper `listReconcilingParadas` cobre 2/5 ledgers — Permuta / SN-recebimentos / Recebimento não têm equivalente

- **Severidade**: P2 (preexistente, **não introduzido nem regredido pelo delta** — flag para o consolidator direcionar ao Availability)
- **Tactic violada**: Reintroduction — State Resync
- **Localização**: `RemessaExecucaoRepository.ts` e `ConciliacaoExecucaoRepository.ts` têm `listReconcilingParadas`; `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts` e `RecebimentoExecucaoRepository.ts` não.
- **Evidência (objetiva)**: `grep -l "listReconcilingParadas" src/backend/domain/repository/**/*.ts` → 2 arquivos.
- **Impacto técnico**: uma linha `reconciling` órfã em Permuta/SN/Recebimento só é vista se um operador rodar SQL manualmente, ou se topar com 409 na tela. O delta atual não muda esse quadro.
- **Impacto de negócio**: baixo por-execução (a idempotency key preserva `settled`), mas a auditoria "quantas execuções deste tenant estão presas há > N minutos" não é possível sem SQL ad-hoc.
- **Métrica de baseline**: 2/5 ledgers têm reaper query. Alvo: 5/5 + um job (EventBridge, quando existir) consumindo.

## 5. Cards Kanban

### [fault-tolerance-1] Estender migration da identidade Conexos ao 6º ledger (`solicitacao_numerario`)

- **Problema**
  > A ADR-0041 declara que "cinco ledgers, não só o da permuta" ganham as colunas de identidade — mas o repo tem um 6º ledger que também escreve no Conexos: `solicitacao_numerario` (permutas, `NumerarioExecucaoRepository`), usado pelo `GerarSolicitacaoNumerarioService` (3 telas). Ele hoje está em dry-run por outras dependências, mas se `CONEXOS_WRITE_ENABLED` for religado, reabre exatamente o buraco que a ADR fechou: escrita real degradando ao robô silenciosamente sem rastro no ledger.

- **Melhoria Proposta**
  > Nova migration `0052_solicitacao_numerario_identidade_conexos.sql` no formato de `0051` (idempotente, sem backfill). Injetar `ConexosIdentityProvider` no construtor de `NumerarioExecucaoRepository` (permutas), estender `INSERT` e `ON CONFLICT` com o mesmo guard `CASE WHEN solicitacao_numerario.status = 'settled' THEN ... ELSE EXCLUDED ...` e os `markSettled`/`markError` com `COALESCE`. Tactic Bass alvo: **Reconcile** (fechar a cobertura de audit trail).

- **Resultado Esperado**
  > 6/6 ledgers que escrevem no Conexos persistindo identidade. Religamento futuro do fluxo 3-telas não reabre o buraco.

- **Tactic alvo**: Reconcile (audit trail)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cobertura de ledgers: 5/6 → 6/6
  - `grep "@inject(ConexosIdentityProvider)" src/backend/domain/repository/**/*.ts` → 6 hits
- **Risco de não fazer**: no dia em que o Yuri (ou um sucessor) reativar o fluxo 3-telas em produção, o incidente da `MARILYN_MUTAFCI` se repete numa frente diferente, e ninguém lembra por que estava incompleto.
- **Dependências**: nenhuma (independente do religamento do writeEnabled)

### [fault-tolerance-2] Defender `avisarDegradacao` contra falha do logger

- **Problema**
  > O caminho de degradação (`resolveForUser` → `catch` → `avisarDegradacao` → `await logService.warn`) não tem try/catch em torno da chamada ao logger. `LogService.warn` hoje só escreve em stdout — risco baixo — mas se um dia ganhar persistência em DB (ou o stdout do container falhar com EPIPE), a exceção sobe até `resolve()` e derruba a escrita financeira. Ou seja: um bug de logging transforma o fallback silencioso corrigido pela ADR-0041 numa queda dura da baixa/remessa/conciliação.

- **Melhoria Proposta**
  > Envolver a chamada em try/catch dentro de `avisarDegradacao` (`ConexosSessionResolver.ts:143-151`), engolindo o erro com um `process.stderr.write` de último recurso. Adicionar 1 teste no `ConexosSessionResolver.test.ts` que mocka `logService.warn` para lançar e verifica que `resolve()` ainda devolve o robô. Tactic Bass: **Sanity Checking** aplicada ao próprio ponto de detecção.

- **Resultado Esperado**
  > Log jamais derruba caminho de escrita financeira. Semântica: "fallback silencioso ao usuário" ficou observável, "fallback silencioso à operação" continua observável, "log quebrado" nunca vira indisponibilidade.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — 15 linhas + 1 teste)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Testes que cobrem "warn lança → resolver segue devolvendo robô": 0 → 1
  - `try { await this.logService.warn(...) } catch { ... }` presente em `avisarDegradacao`
- **Risco de não fazer**: um refactor futuro do `LogService` (ex.: adicionar sink de DB por observabilidade) reintroduz risco de indisponibilidade num ponto que a ADR-0041 promete "não interromper ninguém".
- **Dependências**: nenhuma

### [fault-tolerance-3] Alarme sobre `BUSINESS_WARN` × `motivo` para fechar o MTTD

- **Problema**
  > A ADR-0041 promete "próxima ocorrência em minutos, não em meses" — mas essa promessa depende de alguém ver o `warn` no stdout do Render. Hoje ninguém acompanha stdout em tempo real. O registro fecha a auditoria retroativa; a **notificação** continua aberta (F-5 dos próprios followups). MTTD real de vínculo quebrado permanece indefinido.

- **Melhoria Proposta**
  > Painel simples no Render (ou primeiro job de observabilidade quando a infra de Lambda existir): agregar linhas de log com `type=BUSINESS_WARN` filtradas por `data.motivo IN (decrypt, login)`, dedup por `data.conexosUsername` × dia, alerta no Slack/email quando N > 0 em janela de 15 min. Tactic Bass: **Condition Monitoring** com consumer.

- **Resultado Esperado**
  > MTTD de vínculo Conexos quebrado ≤ 15 minutos. Alarme distingue `decrypt` (chave trocada/ausente — infra) de `login` (senha/limite de sessões — operacional).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M (2-3d — depende do que o Render expõe; potencialmente XL se exigir sidecar de log)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Consumidores de `BUSINESS_WARN`: 0 → 1
  - MTTD de vínculo quebrado: indeterminado → ≤ 15 min (empírico após primeiro incidente)
- **Risco de não fazer**: a próxima `MARILYN_MUTAFCI` volta a levar meses para ser diagnosticada, mesmo com o `warn` sendo emitido — porque ninguém está lendo. O ADR entrega metade do valor.
- **Dependências**: opcional — o ideal é aproveitar quando a stack de observabilidade da fase Lambda existir; entretanto vale um MVP em Render já.

### [fault-tolerance-4] Documentar (e testar) a semântica de identidade sob retry cross-identity

- **Problema**
  > A cláusula `COALESCE(conexos_username, $conexosUsername)` nos terminais é first-wins, mas o `beginExecution` sobrescreve identidade para estados não-`settled`. Efeito líquido: sob retry por identidade DIFERENTE após um timeout-com-sucesso-oculto do ERP, o ledger pode discordar do ERP sobre quem assinou. O caso é raro, mas a coluna promete "identidade da sessão que assinou", e a semântica real é mais sutil.

- **Melhoria Proposta**
  > (a) Acrescentar um parágrafo em `identidade-execucao-conexos.md` explicando: "identidade gravada = quem estava resolvido na hora do write-ahead que precede o `markSettled`; retry cross-identity após timeout com sucesso oculto do ERP é caso de exceção coberto pela checagem obrigatória de `fin010` antes de retry (`idempotencia-reconciliacao.md`)". (b) 1 teste em `PermutaExecucaoRepository.test.ts` fixando explicitamente a semântica atual (retry com identidade diferente sobrescreve). Tactic Bass: **Reconcile** (documentar limite da promessa).

- **Resultado Esperado**
  > A semântica fica explícita; um futuro leitor não interpreta a coluna como "verdade última do ERP" quando é "verdade última do nosso write-ahead".

- **Tactic alvo**: Reconcile
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Teste explícito de retry cross-identity: 0 → 1
  - Doc atualizado
- **Risco de não fazer**: baixo — na prática o caso quase nunca acontece. Vale como higiene documental.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo**: só o DELTA (2 commits sobre `617ca3b`, gate `--quick`). Não avaliei fault-tolerance do repo inteiro — os gaps de reaper em 3 dos 5 ledgers (F-fault-tolerance-5) foram registrados como preexistentes e sinalizados ao consolidator para o `qa-availability` decidir se levanta card próprio.
- **Descoberta inesperada**: existe um SEXTO ledger (`solicitacao_numerario`, permutas) que escreve no Conexos e não recebeu as colunas. A ADR-0041 fala em "cinco ledgers", mas o serviço `GerarSolicitacaoNumerarioService` mantém a trilha viva em dry-run — reflex de a tabela ter sido criada em `0032` numa fatia anterior e ninguém ter agregado. F-fault-tolerance-1 é o único achado do delta que merece atenção próxima (P2 latente).
- **Verdict pedido sobre "first-identity-wins" (item 2 do prompt)**: correto para o caso comum, honesto sobre o caso raro (retry cross-identity após timeout com sucesso oculto). A doutrina `idempotencia-reconciliacao.md` já cobre a mitigação (checar `fin010` antes de retry em `reconciling`). Documentar em F-fault-tolerance-4.
- **Cross-QA para o consolidator**:
  - Security: colunas `conexos_username`/`conexos_usn_cod` viram PII operacional persistida — validar se a política de retenção/redação atual do time cobre; nenhuma senha vaza no `warn` (teste explícito garante).
  - Availability: F-fault-tolerance-5 (reaper 2/5) é herança pré-delta — o `qa-availability` decide.
  - Testability: cobertura de teste do delta é forte (6 arquivos, 1493 testes verdes); único gap testável é o cenário do F-2 (log lança).
- **Não medível**: taxa real de fallback em produção — só o Render/prod sabe.
