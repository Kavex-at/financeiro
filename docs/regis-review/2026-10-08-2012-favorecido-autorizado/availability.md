---
qa: Availability
qa_slug: availability
run_id: 2026-10-08-2012-favorecido-autorizado
agent: qa-availability
generated_at: 2026-10-08T20:30:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG / cron de reconferência | Conexos (`fin064`/`cmn025`) lento ou fora do ar durante a geração da remessa; destino do favorecido muda no cadastro | `RemessaService.exigirFavorecidosAutorizados` → `AuthorizedPayeeService.verificarDestinoAutorizado` → `DestinoPagamentoResolver` | Operação normal, dia de pagamento, lote TED/PIX finalizado | Falhar fechado (nenhuma escrita no Conexos, nenhuma linha no ledger), registrar o motivo por item e permitir retentar sem efeito colateral; abrir reaprovação quando o destino mudar | 0 remessas enviadas sem autorização válida; 0 lotes nativos órfãos no fin015; lote barrado por falha transitória deve se recuperar por retentativa do analista em < 1 ciclo de operação |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos com Executor (backend inteiro) | 15 | n/a (informativo) | ⚠️ | `grep -rln "RetryExecutor\|FallbackExecutor\|PollExecutor" src/backend --include=*.ts` |
| Leituras Conexos da guarda cobertas por Retry | `ConexosBaseClient` usa `RetryExecutor` (1 retry, 500 ms + jitter); a guarda em si não adiciona retry | ≥ 80% | ⚠️ | `domain/client/ConexosBaseClient.ts:134-154` |
| Clientes externos com timeout explícito (caminho da guarda) | 1/1 (axios do Conexos, 40 000 ms, código não alterado pela feature) | 100% | ✅ | `services/conexos.ts:116-121` |
| Lock otimista + evento na mesma transação nas transições do favorecido | 5/5 pontos de escrita usam `withTransaction` + `atualizarComVersao` | 100% | ✅ | `AuthorizedPayeeService.ts:127,146,203,340,451,499` |
| Guarda de transição inválida (state machine) | Presente: estados CHECK no banco, índice único parcial de vigente, `REJEITADO/REVOGADO` exigem motivo, `AUTORIZADO` exige fingerprint | presente | ✅ | `migrations/0080_sispag_favorecido_autorizado.sql` |
| Falha fechada na remessa | Qualquer resultado ≠ OK (inclusive falha de leitura) barra o lote inteiro antes de escrita | presente | ✅ | `RemessaService.ts:1234-1297`, chamada em `:399-402` |
| Catches silenciosos introduzidos | 2, ambos deliberados (`.catch(() => null)` na leitura do título; `.catch(() => undefined)` no log do alerta) | 0 não justificados | ⚠️ | `RemessaService.ts:1247`, `AuthorizedPayeeService.ts:560` |
| DLQ / alarmes CloudWatch / `shared_account_id` | ⚠️ **Não medível**: não existe `infra/`; a feature não adiciona fila nem job agendado | — | n/a | `ls infra` |
| Gates do delta | typecheck 0 erros, lint 0, jest 223 suites / 3967 testes, test:sql 0080 ok | verde | ✅ | `_shared-metrics.md` |
| Idempotência (chave) da remessa | Não alterada pela feature; guarda só roda se não houver lote nativo (retomada ADR-0039 preservada) | n/a | ✅ | `RemessaService.ts:393-402` |

> ⚠️ **Não medível localmente**: MTTR real e taxa de lotes barrados por `FALHA_LEITURA`. Requer consulta em produção (`sispag_verificacao_evento`). Recomendação: dashboard com a contagem diária de barramentos por motivo e o tempo `candidato → enviado`.

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não há sonda ativa do Conexos para a guarda | ❌ ausente | n/a |
| Heartbeat | Sem scheduler; N/A para a feature (sem job novo) | N/A | Sem EventBridge neste repo |
| Monitor | Eventos `sispag_verificacao_evento` e `LogService.warn` na barragem; sem alarme | ⚠️ parcial | `RemessaService.ts:1285-1292` |
| Timestamp | `ultima_conferencia_em`, `decidido_em`, `ocorrido_em` na trilha | ✅ presente | `0080_*.sql` |
| Sanity Checking | CHECKs de estado/modalidade/fingerprint/motivo e índice único de vigente | ✅ presente | `0080_*.sql` |
| Condition Monitoring | Reconferência de destino com selo (IGUAL/DIFERENTE/SEM_DADO/FALHA_LEITURA) | ✅ presente | `AuthorizedPayeeService.ts:323-345` |
| Voting | N/A: fonte única de verdade do destino (cmn025) por decisão de domínio | N/A | ADR-0065 |
| Exception Detection | Erros tipados (`PayeeNotAuthorizedAtRemittanceError` etc.), falha de leitura vira `FALHA_LEITURA`, nunca "sem dado" | ✅ presente | `AuthorizedPayeeService.ts:604-615` |
| Self-Test | `validate-sispag-favorecido-autorizado-v1.ts` e test:sql de migração | ⚠️ parcial | `jobs/validate-sispag-favorecido-autorizado-v1.ts` |
| Active Redundancy | N/A: sem redundância de réplica no deploy atual (Render) | N/A | CLAUDE.md |
| Passive Redundancy | N/A | N/A | idem |
| Spare | N/A | N/A | idem |
| Exception Handling | Alerta de destino alterado não desfaz a reaprovação já gravada; falha vira log | ✅ presente | `AuthorizedPayeeService.ts:549-562` |
| Rollback | Rollback só de estrutura; migração aborta inteira se houver dado (transação única) | ⚠️ parcial | `rollbacks/0080_*.rollback.sql`, guarda em `0080_*.sql` |
| Software Upgrade | Flag `sispagFavorecidoAutorizadoEnabled` por tenant liga/desliga a guarda | ✅ presente | `AuthorizedPayeeService.ts:293-303` |
| Retry | Herdado do `ConexosBaseClient` (1 retry); a guarda não retenta a leitura que falhou | ⚠️ parcial | `RemessaService.ts:1244-1247` |
| Ignore Faulty Behavior | N/A: para dinheiro, o comportamento correto é recusar | N/A | falha fechada |
| Degradation | Item sem autorização barra o lote inteiro (sem envio parcial dos itens válidos) | ⚠️ parcial | `RemessaService.ts:1297` |
| Reconfiguration | Flag por tenant e por modalidade; sem reconfiguração dinâmica além disso | ⚠️ parcial | `AuthorizedPayeeService.ts:294-303` |
| Shadow | `validate-sispag-favorecido-autorizado-v1` é validação offline, não execução sombra | ⚠️ parcial | `jobs/validate-*.ts` |
| State Resynchronization | Reaprovação reabre estado ao detectar divergência; retomada ADR-0039 não é barrada | ✅ presente | `RemessaService.ts:393-402` |
| Escalating Restart | N/A: sem processo supervisor próprio neste escopo | N/A | Render |
| Non-Stop Forwarding | N/A | N/A | n/a |
| Removal from Service | Flag desliga a guarda; sem circuit breaker para o Conexos | ⚠️ parcial | `EnvironmentVars.ts:188-193` |
| Transactions | Estado + evento na mesma transação, lock otimista por `versao`, trilha só-inclusão por trigger | ✅ presente | `AuthorizedPayeeService.ts:85,127`; `0080_*.sql` |
| Predictive Model | Ausente | ❌ ausente | n/a |
| Exception Prevention | Zod no destino manual removido do fluxo; guarda antes de escrita; destino nunca gravado em claro (HMAC) | ✅ presente | `0080_*.sql` cabeçalho |
| Increase Competence Set | Cache de leitura do cadastro por verificação (`CacheCadastroDestino`) evita leituras repetidas | ⚠️ parcial | `AuthorizedPayeeService.ts:310` |

## 4. Findings (achados)

### F-availability-1: Falha transitória na leitura do título barra o lote inteiro sem retentativa própria

- **Severidade**: P2
- **Tactic violada**: Retry / Degradation
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1244-1297`
- **Evidência (objetiva)**:
  ```
  const lido = await this.sispag.getTituloAPagar(...).catch(() => null);
  if (lido?.pesCod) pesCodPor.set(...)   // sem pesCod => FALHA_LEITURA
  ... if (barrados.length > 0) throw new PayeeNotAuthorizedAtRemittanceError(...)
  ```
- **Impacto técnico**: um único `fin064` com erro (após o 1 retry do cliente) vira `FALHA_LEITURA` e recusa o lote todo; o erro original é descartado (sem status HTTP no log).
- **Impacto de negócio**: o comportamento é seguro (nenhum pagamento errado), mas custa remessa atrasada em dia de pagamento; analista não distingue "não autorizado" de "Conexos instável".
- **Métrica de baseline**: 1 retry herdado do cliente; 0 retentativas na guarda; lote é tudo-ou-nada.

### F-availability-2: Leituras da guarda são sequenciais, no caminho síncrono da geração da remessa

- **Severidade**: P2
- **Tactic violada**: Exception Prevention (limite de latência)
- **Localização**: `RemessaService.ts:1244-1248` (loop `for ... await`)
- **Evidência (objetiva)**:
  ```
  for (const item of alvo) { const lido = await this.sispag.getTituloAPagar(...)... }
  ```
- **Impacto técnico**: N itens TED/PIX × latência Conexos (timeout de 40 s por chamada, até 2 tentativas) no pior caso; sem limite superior para o conjunto.
- **Impacto de negócio**: lotes grandes ficam lentos com Conexos degradado; risco de timeout do request HTTP e de reexecução manual pelo analista.
- **Métrica de baseline**: concorrência 1; `BoundedConcurrency` já existe em `domain/libs/concurrency/`. Latência real: não medida.

### F-availability-3: Sem alarme ou métrica para barramentos e reaprovações abertas

- **Severidade**: P2
- **Tactic violada**: Monitor
- **Localização**: `RemessaService.ts:1285-1292`; `AuthorizedPayeeService.ts:536-562`
- **Evidência (objetiva)**: a barragem só grava `logService.warn`; o alerta `sispag-destino-alterado` é emitido, mas a perda dele é engolida com `.catch(() => undefined)` no log.
- **Impacto técnico**: um pico de `FALHA_LEITURA` (Conexos fora) só é percebido quando o analista reclama.
- **Impacto de negócio**: tempo de detecção depende do usuário.
- **Métrica de baseline**: 0 alarmes/painel para a taxa de barramento (não há `infra/`; medida local).

## 5. Cards Kanban

### [availability-1] Distinguir indisponibilidade do Conexos de "não autorizado" e retentar a leitura

- **Problema**
  > A guarda converte qualquer erro de `getTituloAPagar` em `FALHA_LEITURA` e recusa o lote inteiro, descartando a causa. Em instabilidade curta do Conexos o analista é barrado e não sabe se deve agir no cadastro ou apenas tentar de novo.

- **Melhoria Proposta**
  > Envolver a leitura do título num `RetryExecutor` com backoff, preservar o status HTTP no log (sem dados do destino) e expor no erro um motivo `CONEXOS_INDISPONIVEL` separado de `FAVORECIDO_NAO_AUTORIZADO`. Manter a falha fechada.

- **Resultado Esperado**
  > Lotes barrados por falha transitória caem sem intervenção; a tela mostra a causa certa. Retentativas da guarda: 0 → 2 com backoff.

- **Tactic alvo**: Retry
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Retentativas na guarda: 0 → 2
  - Motivos distinguíveis na barragem: 1 (`FALHA_LEITURA`) → 2
- **Risco de não fazer**: remessas atrasadas em dias de instabilidade do Conexos e triagem errada pelo analista.
- **Dependências**: nenhuma

### [availability-2] Limitar e paralelizar com concorrência controlada as leituras da guarda

- **Problema**
  > O loop sequencial de `getTituloAPagar` soma a latência de todos os itens TED/PIX no caminho síncrono da remessa.

- **Melhoria Proposta**
  > Usar `BoundedConcurrency` (já no repo) com limite pequeno e respeitar o teto do cache de cadastro; medir a duração da guarda no log.

- **Resultado Esperado**
  > Tempo da guarda deixa de crescer linearmente com o tamanho do lote. Concorrência: 1 → limite configurável (ex.: 4).

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Concorrência das leituras: 1 → configurável
  - Duração da guarda por lote: não medida → logada
- **Risco de não fazer**: timeouts em lotes grandes e reexecução manual.
- **Dependências**: nenhuma; respeitar o limite de sessão do Conexos (ver memória sobre cap de sessões)

### [availability-3] Painel e alarme para barramentos da guarda e reaprovações abertas

- **Problema**
  > Barramentos por `FALHA_LEITURA` e reaprovações pendentes só aparecem em log; não há agregação nem alerta de taxa.

- **Melhoria Proposta**
  > Agregar `sispag_verificacao_evento` por motivo/dia em um painel (painel-operacao) e emitir alerta quando a taxa de `FALHA_LEITURA` passar de um limiar. Tactic: Monitor.

- **Resultado Esperado**
  > Detecção de indisponibilidade do Conexos pela taxa de barramento, sem depender do analista. Alarmes: 0 → 1 e painel por motivo.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Alarmes sobre a guarda: 0 → 1
  - Tempo para detectar Conexos instável: depende do usuário → < 15 min
- **Risco de não fazer**: dia de pagamento perdido sem sinal prévio.
- **Dependências**: availability-1 (motivo distinguível)

## 6. Notas do agente

- Escopo: delta da feature; sem P0. A guarda é fail-closed, antes de qualquer escrita, e preserva a retomada ADR-0039 (sem lote nativo órfão).
- Não medíveis: DLQ, alarmes, blast radius por conta (não há `infra/`; a feature não cria fila nem job agendado).
- A migração 0080 é destrutiva, mas protegida por guarda que aborta a transação inteira se houver linha (0 linhas medidas em produção segundo o cabeçalho; não reverifiquei). Rollback é só de estrutura.
- Cross-QA: a perda do alerta engolida em log pertence também a observabilidade/testability; timeout de 40 s no legado `services/conexos.ts` é herdado.
