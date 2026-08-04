---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-07-24-2153
agent: qa-fault-tolerance
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 7.5
findings_count: 6
cards_count: 6
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Módulo 5 (coordinator) durante um `run` real do pipeline | Retry (SQS/analista/timeout) redispara `RecebimentoPipelineService.run` com a mesma `correlationId` após `gravarBaixa` ter sido postada no Conexos, mas antes de `markSettled` retornar | `RecebimentoExecucaoRepository.beginExecution` + `recebimento_execucao (0035)` — ledger write-ahead da baixa+NDe | Produção, ERP intermitente (5xx / timeout); Conexos `fin010` sem endpoint de rollback | O ledger reconhece a linha existente (`ON CONFLICT idempotency_key`) e preserva `settled` se já confirmada; caso contrário mantém `reconciling`, e o coordinator NÃO deve emitir uma segunda baixa/NDe nem regredir uma linha `settled` | 0 quitações duplicadas em `bxa_cod_seq`; 0 NDe duplicadas por `Recebimento`; 100% das falhas de POST terminam em `status='error'` no ledger com `erp_response` cru (nunca `settled` fantasma) |

Adicional (escopo scaffold): "toda transição ilegal do `Recebimento` (ex.: `rascunho→executado`, `executado→rascunho`) deve falhar rápido com `IllegalTransitionError` (409) antes de tocar o ERP" — MTTR = imediato (guard puro, sem I/O).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations com CHECK enum em `status` (Frente IV) | 3/3 (`recebimento`, `transacao_bancaria`, `recebimento_execucao`) + `nota_debito_eletronica` (4/4) | 100% das entidades com máquina de estado | ✅ | `grep -n "CHECK (status" migrations/003[2-8]_*.sql` |
| `idempotency_key` UNIQUE em tabelas write-ahead | 2/2 (`recebimento_execucao.idempotency_key`, `nota_debito_eletronica.idempotency_key`) | 2/2 | ✅ | `migrations/0035_recebimento_execucao.sql:27`, `migrations/0038_nota_debito_eletronica.sql:22` |
| `natural_key` UNIQUE em `transacao_bancaria` (dedup de ingest) | 1/1 | 1/1 | ✅ | `migrations/0032_transacao_bancaria.sql:24` |
| Preservação de `settled` no upsert do ledger (não regride em retry) | 3 colunas guardadas (`status`,`dry_run`,`executado_por`) via `CASE WHEN status='settled' THEN … ELSE EXCLUDED …` | espelhar Permutas | ✅ | `RecebimentoExecucaoRepository.ts:49-57` |
| Transições ilegais bloqueadas pelo guard puro (`Recebimento`) | 4/4 legais + 4/4 ilegais cobertas por teste | 100% de cobertura das transições declaradas | ✅ | `recebimentoTransitions.test.ts:14-64` |
| Cobertura de teste do branch `alreadySettled` (idempotência do coordinator) | 1 teste ("short-circuits when the ledger reports alreadySettled") | ≥1 | ✅ | `RecebimentoPipelineService.test.ts:83-95` |
| **Cobertura de teste do branch de erro do ledger (`markError`)** | **0 testes; coordinator nunca chama `markError`** | ≥1 caminho de teste que force `criarBordero`/`gravarBaixa`/`emitir` a lançar e verifique `markError` | ❌ | `grep -n 'markError\|try\|catch' RecebimentoPipelineService.ts` → vazio |
| **Try/catch em torno de escritas externas no coordinator** | **0** (`criarBordero → gravarBaixa → emitir → markSettled` roda em sequência sem `try/catch`) | envolver o bloco entre `beginExecution` e `markSettled` (padrão Permutas §7) | ❌ | `RecebimentoPipelineService.ts:219-242` |
| **Persistência antecipada de `borCod` (setBorCod entre `criarBordero` e `gravarBaixa`)** | **ausente** — `RecebimentoExecucaoRepositoryInterface` não expõe `setBorCod`/`setRequestPayload` | espelhar `PermutaExecucaoRepository.setBorCod` para recuperar órfão em caso de crash entre POSTs | ❌ | `ports.ts:199-206` vs `PermutaExecucaoRepository.ts:259-267` |
| **Optimistic concurrency (`versao`) usada no WHERE do UPDATE** | **coluna existe** (`0033:19`) e é retornada pelo `mapRow`, mas o `save` faz `versao = EXCLUDED.versao` sem `WHERE versao = $expected` — clobber silencioso | `WHERE id = $id AND versao = $expectedVersao`; 0 linhas afetadas → conflito | ❌ | `RecebimentoRepository.ts:35-43` |
| Seam de reversibilidade (`EXECUTADO → ESTORNADO`) | Transição declarada no state-machine + guard puro, mas nenhum método de serviço/repositório o exercita (busca por `estornar/estorno` no diretório retorna vazio) | ≥1 método `estornar` no coordinator ou service dedicado (mesmo stubbed) | ⚠️ | `grep -rn 'estornar\|estorno' src/backend/domain/{service,repository}/recebimentos/` → vazio |
| `recebimentosGate` fecha superfície HTTP em prod | 403 quando `recebimentosEnabled=false` (padrão prod) | ativo por padrão | ✅ | `http/recebimentosGate.ts:14-22` |
| Suite passa verde (regressão) | 63 suites / 675 testes passando | verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: taxa real de retry/DLQ do pipeline em produção (não há SQS/Lambda para a Frente IV ainda — o coordinator hoje é chamado sincronamente por `POST /recebimentos/pipeline/run`). Medir após a migração alvo p/ EventBridge/`job/` Lambda descrita em `frente-iv-arquitetura-modular.md §7`.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A | N/A | Escopo scaffold — sem redundância física (single-region/single-DB). |
| Replacement | N/A | N/A | Idem. |
| Predictive Model | ausente por design nesta fase | N/A | Nenhum monitoring proativo do pipeline previsto no scaffold. |
| Increase Competence Set | Zod nos boundaries dos DTOs; state-machine guard puro rejeita transições ilegais | ✅ | `schemas.test.ts:1-…`, `recebimentoTransitions.ts:36-50` |
| Sanity Checking | `beginExecution` retorna `alreadySettled` para o coordinator; CHECK constraints no DB CHECK enum nos 4 tables de status | ✅ | `RecebimentoExecucaoRepository.ts:39-69`, `0035:16`, `0033:14`, `0032:21`, `0038:15` |
| Comparison | ausente — sem reconciliação periódica prevista contra o `fin010`/NDe emitida no ERP | ❌ | Nenhum job/service no scaffold; nenhuma seam de comparação declarada em `ports.ts`. |
| Timestamp | `criado_em`/`atualizado_em`/`importado_em` em todas as tabelas; `atualizado_em = now()` em cada `markSettled/markError` | ✅ | `0032:23`, `0033:24`, `0035:25-26`, `0038:21` |
| Timeout | ausente na camada scaffold — depende do futuro `NexxeraGatewayInterface`/`ErpReceivablesGatewayInterface` (stubs sync); nenhum contrato de timeout no port | ⚠️ | `ports.ts:132-171` (interfaces sem hint de timeout) — a ser adicionado quando cada real client for plugado (cross-ref qa-availability). |
| Condition Monitoring | `MetricsPortInterface.emit` chamado em `started`/`ok` de cada stage; correlationId propagado via `withCorrelationId` (pass-through no stub) | ✅ (started/ok) / ⚠️ (`error`) | `RecebimentoPipelineService.ts:98-262` — nunca emite `outcome:'error'` (nenhum `catch` no coordinator). O contrato `MetricsEvent.outcome` prevê `'error'` mas não é exercitado. |
| Self-Test | Suite `RecebimentoPipelineService.test.ts` roda coordinator ponta a ponta com stubs; guards têm cobertura direta | ✅ | 3 testes novos + 675 verdes |
| Voting | N/A | N/A | Não há redundância de resultado; a fonte de verdade é o ERP. |
| Redundancy | N/A | N/A | Idem. |
| Recovery — Rollback | ausente — nenhum `Recebimento`/NDe pode ser desfeito no scaffold; transição `EXECUTADO→ESTORNADO` existe no guard mas nenhum service a exercita | ⚠️ | Ver F-fault-tolerance-4. |
| Recovery — Repair State | `markError` existe no repositório mas o coordinator NUNCA o chama (não há `try/catch`); linha órfã ficaria em `reconciling` para sempre em caso de falha entre POSTs | ❌ | F-fault-tolerance-1 / F-fault-tolerance-2 |
| Reintroduction — Shadow / State Resync | `dry_run` boolean (default TRUE) permite modo "shadow": monta e loga o payload sem POST real; preservado no `beginExecution` | ✅ | `0035:18`, `RecebimentoExecucaoRepository.ts:42` |
| Reintroduction — Escalating Restart | N/A | N/A | Fora do escopo scaffold. |
| Rollback | ver acima | ⚠️ | Idem. |
| Repair State | `markSettled` limpa `erro_mensagem` (`= NULL`) quando a linha se conclui após retry — bom | ✅ | `RecebimentoExecucaoRepository.ts:81` |
| Idempotent Replay | Ledger write-ahead com `UNIQUE (idempotency_key)` + preservação de `settled` no upsert; short-circuit `alreadySettled` no coordinator | ✅ | `0035:27`, `RecebimentoExecucaoRepository.ts:49-69`, `RecebimentoPipelineService.ts:209-217` |
| Compensating Transaction | ausente por design (ERP não expõe undo limpo) — a política **implícita** é forward recovery via analista, mas não está seedada como seam (nenhum método `estornar`/`reabrir` no service) | ❌ | F-fault-tolerance-4 |
| Reconcile | ausente — nenhum job periódico que compare `recebimento_execucao.status='settled'` × baixas realmente presentes no `fin010`; nenhum reaper para linhas `reconciling` órfãs | ❌ | F-fault-tolerance-5 |
| Quarantine | ausente — não há status "quarentena" no `Recebimento` para casos que precisam de análise humana pós-falha (state-machine só tem rascunho/aprovado/executado/estornado) | ⚠️ | F-fault-tolerance-6 (opcional — pode ser resolvido via fila da analista + status `erro` na `transacao_bancaria`) |

## 4. Findings (achados)

### F-fault-tolerance-1: Coordinator não envolve escritas externas em try/catch → `markError` nunca é acionado

- **Severidade**: P1
- **Tactic violada**: Recovery — Repair State; Condition Monitoring (branch `outcome:'error'` nunca emitido)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:183-264` (todo o `executarRecebimento`); `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts:93-109` (`markError` existe, sem chamador)
- **Evidência (objetiva)**:
  ```
  $ grep -n 'try\|catch\|markError' RecebimentoPipelineService.ts
  (nenhuma ocorrência)
  ```
  ```typescript
  // RecebimentoPipelineService.ts:219-242 — 3 POSTs sequenciais sem catch
  const bordero = await this.erp.criarBordero({...});
  const baixa   = await this.erp.gravarBaixa({...});
  const nde     = await this.ndeEmitter.emitir(aprovado);
  await this.execucaoRepository.markSettled(idempotencyKey, {...});
  ```
  Comparar com o padrão comprovado do Permutas: `ReconciliacaoPermutaService.ts:253-…` faz `} catch (err) { await this.execucaoRepository.markError(key, { erroMensagem, erpResponse }) }`.
- **Impacto técnico**: se `criarBordero` retorna 5xx, `gravarBaixa` lança timeout, ou `emitir` falha, a exceção sobe pelo `run()` sem passar pelo ledger. A linha em `recebimento_execucao` fica presa em `reconciling` para sempre; o retry (mesma `idempotency_key`) fará `beginExecution` retornar `status='reconciling', alreadySettled=false` e RE-executará os POSTs — potencialmente **duplicando** a baixa no `fin010` se a primeira `gravarBaixa` teve efeito antes do erro (ERP intermitente).
- **Impacto de negócio**: risco de baixa duplicada em recebíveis reais (o financeiro-inbound análogo do "no double-execution"). Sem `markError`, nenhum operador enxerga a linha vermelha na tela — a Frente IV vira uma caixa preta em incidente.
- **Métrica de baseline**: 0 testes cobrem o branch de erro (`grep -n 'markError\|reject\|throw' RecebimentoPipelineService.test.ts` → vazio); 100% dos 3 POSTs externos sem `catch`; 0/3 stages emitem `MetricsEvent{ outcome: 'error' }`.

### F-fault-tolerance-2: `borCod` só é persistido no `markSettled` — órfão se `gravarBaixa`/`emitir` falhar entre POSTs

- **Severidade**: P1
- **Tactic violada**: Repair State; Idempotent Replay (recuperação de órfão)
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:199-206` (interface do ledger sem `setBorCod`/`setRequestPayload`); `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:219-242`
- **Evidência (objetiva)**:
  ```
  $ grep -n 'setBorCod\|setRequestPayload\|request_payload' \
       src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts \
       src/backend/domain/interface/recebimentos/ports.ts
  (nenhuma ocorrência)
  ```
  ```typescript
  // Permutas — PermutaExecucaoRepository.ts:259-266 (padrão a espelhar)
  public setBorCod = async (key, borCod) => {
      await this.databaseClient.update(
          `UPDATE permuta_alocacao_execucao SET bor_cod = $borCod, atualizado_em = now() WHERE idempotency_key = $key`,
          { key, borCod },
      );
  };
  ```
- **Impacto técnico**: se `criarBordero` retorna `borCod=999000` mas o processo cai antes de `gravarBaixa`, o borderô fica órfão no ERP e o ledger não sabe qual `borCod` foi criado — sem `borCod` gravado, nem análise manual, nem reaper conseguem reconciliar. A migração 0035 tem a coluna `bor_cod BIGINT` e `request_payload JSONB` prontas, mas o repositório não expõe métodos para preenchê-las incrementalmente.
- **Impacto de negócio**: borderô fantasma no Conexos que a Frente IV não consegue rastrear; retrabalho do analista para descobrir "qual borderô meu sistema criou e não usou".
- **Métrica de baseline**: 0 métodos incrementais de write-ahead (`setBorCod`, `setRequestPayload`) no `RecebimentoExecucaoRepositoryInterface` (2 métodos: `beginExecution` + `markSettled/markError`); Permutas expõe 4 (`beginExecution`, `setBorCod`, `setRequestPayload`, `markSettled`).

### F-fault-tolerance-3: `versao` (optimistic concurrency) presente na tabela mas nunca aplicada no `UPDATE` do repositório

- **Severidade**: P1
- **Tactic violada**: Sanity Checking (lost update); Comparison
- **Localização**: `src/backend/migrations/0033_recebimento.sql:19` (declara `versao INTEGER NOT NULL DEFAULT 0` + comentário "Concorrência otimista (espelha o I6 do lote)"); `src/backend/domain/repository/recebimentos/RecebimentoRepository.ts:35-43` (upsert faz `versao = EXCLUDED.versao` sem guarda)
- **Evidência (objetiva)**:
  ```sql
  -- migrations/0033_recebimento.sql:18-19
  -- Concorrência otimista (espelha o I6 do lote).
  versao INTEGER NOT NULL DEFAULT 0,
  ```
  ```typescript
  // RecebimentoRepository.ts:35-43 — o UPDATE clobbera silenciosamente
  ON CONFLICT (id) DO UPDATE SET
      classificacao_match = EXCLUDED.classificacao_match,
      status = EXCLUDED.status,
      ...
      versao = EXCLUDED.versao,       // sobrescreve, não incrementa; sem WHERE versao = $expected
  ```
- **Impacto técnico**: dois writers concorrentes (analista atualizando rateio + coordinator gravando resultado) sobrescrevem-se mutuamente sem detecção. O 2º save sempre vence — invariante I-Receb-1 (Σ rateio ≤ valorRecebido) pode ser silenciosamente violada se o rateio for recomputado em paralelo com uma edição manual.
- **Impacto de negócio**: divergência silenciosa entre o `resultado_execucao` gravado e o rateio efetivamente vigente; auditoria vira "quem gravou por último ganhou".
- **Métrica de baseline**: 1/1 tabela declara `versao` mas 0/1 repositório aplica `WHERE versao = $expected` no UPDATE; 0 testes verificam conflito de versão.

### F-fault-tolerance-4: Seam de reversibilidade (`EXECUTADO → ESTORNADO`) ausente no service — só existe no guard puro

- **Severidade**: P2
- **Tactic violada**: Compensating Transaction; Rollback
- **Localização**: `src/backend/domain/interface/recebimentos/recebimentoTransitions.ts:31` (a transição existe: `EXECUTADO → [ESTORNADO]`); nenhum arquivo de serviço com verbo `estornar/estorno` (grep vazio)
- **Evidência (objetiva)**:
  ```
  $ grep -rn 'estornar\|estorno\|ESTORNADO' \
       src/backend/domain/service/recebimentos/ src/backend/domain/repository/recebimentos/
  (nenhuma ocorrência)
  ```
  Contraste: o `Recebimento` DTO expõe `estornadoPor?: string` e a coluna `estornado_por TEXT` existe na migração 0033:23, prontas para receber, mas nenhum método de serviço as popula.
- **Impacto técnico**: quando a NDe é emitida errado ou o borderô precisa ser cancelado, o fluxo "estornar recebimento" não tem seam — teammates da Fase 5 vão ter que criar o método do zero, provavelmente sem seguir o padrão de write-ahead (risco de introduzir divergência ledger×ERP na reversão). Política implícita "forward recovery via analista" está correta como decisão de design, mas não está seedada nem documentada como um método explícito.
- **Impacto de negócio**: analista perde a rota programática para desfazer uma baixa/NDe errada — vira ticket manual no ERP.
- **Métrica de baseline**: 1/4 transições legais do state-machine com seam de código (rascunho→aprovado→executado exercitados; estornado nunca). Cobertura de execução da transição `EXECUTADO→ESTORNADO`: 0%.

### F-fault-tolerance-5: Nenhum reaper/reconciliador previsto para linhas `reconciling` órfãs ou divergência com o ERP

- **Severidade**: P2
- **Tactic violada**: Reconcile; Condition Monitoring
- **Localização**: escopo scaffold — nenhum job/service; `ports.ts` não declara `ReceivablesReconcilerInterface`
- **Evidência (objetiva)**:
  ```
  $ grep -rn 'reconcile\|reaper\|stuck' \
       src/backend/domain/service/recebimentos/ src/backend/domain/interface/recebimentos/
  (nenhuma ocorrência)
  ```
- **Impacto técnico**: se F-fault-tolerance-1 se materializar em produção, linhas ficam `reconciling` para sempre sem que ninguém detecte. Não há seam para "listar execuções paradas há > N horas" nem para "conferir se o `bxa_cod_seq` gravado ainda existe no `fin010`".
- **Impacto de negócio**: divergência silenciosa acumulativa entre o dashboard e a realidade do ERP — o mesmo tipo de risco que a Frente II mitiga com a tela de retorno .RET.
- **Métrica de baseline**: 0 métodos de listagem por status/idade no `RecebimentoExecucaoRepositoryInterface` (só `findByIdempotencyKey`); 0 seams de reconciliação declaradas.

### F-fault-tolerance-6: `MetricsPort.withCorrelationId` é pass-through no stub — real impl PRECISA vincular ao logService, sem contrato que force isso

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring (rastreabilidade cross-stage)
- **Localização**: `src/backend/domain/service/recebimentos/stubs/MetricsPortStub.ts:28-30` (pass-through); `src/backend/domain/interface/recebimentos/ports.ts:174-182` (comentário adverte, mas a interface não força)
- **Evidência (objetiva)**:
  ```typescript
  // MetricsPortStub.ts:28-30
  public withCorrelationId = <T>(_correlationId: string, fn: () => T): T => {
      return fn();
  };
  ```
  ```typescript
  // ports.ts:176-182 — o contrato é uma discipline note, não uma assinatura
  /** … The scaffold stub is a pass-through; the real Módulo 6 impl MUST bind the id to the
   * log context inside the scope … */
  ```
- **Impacto técnico**: se Módulo 6 esquecer de fazer `logService.setMetadata({ qive_id: correlationId })` dentro do escopo, os logs downstream do coordinator vão perder o correlationId — a rastreabilidade cross-stage vira best-effort. Nada trava na compilação/teste.
- **Impacto de negócio**: dificulta o postmortem em incidente (não dá para rastrear um `Recebimento` específico através dos logs de 5 stages).
- **Métrica de baseline**: 0 testes de contrato que verifiquem "todo log emitido dentro de `withCorrelationId(x, …)` carrega `qive_id=x`".

## 5. Cards Kanban

### [fault-tolerance-1] Envolver escritas externas do coordinator em try/catch + `markError` (padrão Permutas)

- **Problema**
  > `RecebimentoPipelineService.executarRecebimento` chama `criarBordero → gravarBaixa → emitir → markSettled` em sequência sem `try/catch`. Se qualquer POST falhar, a exceção sobe pelo `run()`, a linha em `recebimento_execucao` fica presa em `reconciling` e o retry seguinte re-executa os POSTs — abrindo espaço para baixa duplicada no `fin010` (violação direta da promessa "no double-execution").

- **Melhoria Proposta**
  > Espelhar `ReconciliacaoPermutaService.ts:220-260`: `try { criarBordero; gravarBaixa; emitir; markSettled } catch (err) { await execucaoRepository.markError(idempotencyKey, { erroMensagem: err.message, erpResponse: err.response }); this.metrics.emit({ stage: 'executarRecebimento', outcome: 'error', … }); throw err; }`. Adicionar 3 testes (uma falha por POST) exercitando o path de erro, verificando `markError` foi chamado e `MetricsEvent.outcome='error'` foi emitido. Tactic Bass: **Repair State** + **Condition Monitoring**.

- **Resultado Esperado**
  > Toda falha entre `beginExecution` e `markSettled` deixa a linha em `error` com `erp_response` cru; retry seguinte re-consulta `beginExecution`, vê `status='error'` (não `settled`), e o coordinator decide reprocessar (ou o analista intervém). 0% de linhas presas em `reconciling` para sempre.

- **Tactic alvo**: Recovery — Repair State (+ Condition Monitoring)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cobertura de teste do branch de erro: 0 → ≥3 testes (uma falha por POST externo)
  - `MetricsEvent{ outcome: 'error' }` emitido: 0/3 stages → 3/3 stages executivos
- **Risco de não fazer**: em 6 meses de produção, uma janela de instabilidade do Conexos vira uma baixa duplicada real em receita — reversão manual no ERP + conciliação bancária divergente.
- **Dependências**: nenhuma (padrão já provado em Permutas).

### [fault-tolerance-2] Adicionar `setBorCod` (e opcionalmente `setRequestPayload`) ao `RecebimentoExecucaoRepositoryInterface`

- **Problema**
  > Se `criarBordero` retorna `borCod` mas o processo cai antes de `gravarBaixa`, o borderô fica órfão no Conexos e o ledger não tem como associá-lo à linha em `reconciling`. O `RecebimentoExecucaoRepositoryInterface` só expõe `beginExecution + markSettled/markError`, faltando a persistência incremental que Permutas usa (`setBorCod`, `setRequestPayload`) — as colunas já existem na migração 0035.

- **Melhoria Proposta**
  > Estender `RecebimentoExecucaoRepositoryInterface` (`ports.ts:199-206`) e a impl (`RecebimentoExecucaoRepository.ts`) com: `setBorCod(key, borCod)`, `setRequestPayload(key, payload)`. Coordenador chama `setBorCod` LOGO após `criarBordero` retornar, ANTES de `gravarBaixa`. Tactic Bass: **Idempotent Replay** (recuperação de órfão).

- **Resultado Esperado**
  > Todo `borCod` criado é persistido antes do próximo POST — reaper (fault-tolerance-5) consegue reconstruir a intenção mesmo em falha entre POSTs. Métodos incrementais no interface: 2 → 4 (paridade com Permutas).

- **Tactic alvo**: Repair State; Idempotent Replay
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Cobertura de recuperação de órfão: 0% → 100% (`bor_cod IS NOT NULL AND status='reconciling'` pode ser inspecionado)
  - Testes: adicionar 1 teste que quebra entre `criarBordero` e `gravarBaixa` e confirma `bor_cod` gravado
- **Risco de não fazer**: analista ganha borderôs fantasma no Conexos sem rastro no dashboard da Frente IV — retrabalho manual crescente.
- **Dependências**: [fault-tolerance-1] (o `try/catch` fica em volta destes writes).

### [fault-tolerance-3] Aplicar `WHERE versao = $expectedVersao` no `RecebimentoRepository.save` (optimistic concurrency real)

- **Problema**
  > A migração 0033 declara `versao INTEGER NOT NULL DEFAULT 0` com o comentário "Concorrência otimista (espelha o I6 do lote)", mas o `save` faz `versao = EXCLUDED.versao` sem `WHERE versao = $expected`. Dois writers concorrentes (analista + coordinator) se sobrescrevem sem detecção — a invariante I-Receb-1 (Σ rateio ≤ valorRecebido) pode ser violada silenciosamente.

- **Melhoria Proposta**
  > Reescrever `RecebimentoRepository.save` para: `INSERT … ON CONFLICT (id) DO UPDATE SET … versao = recebimento.versao + 1 WHERE recebimento.versao = $expectedVersao RETURNING versao`. Se 0 linhas afetadas → lançar `RecebimentoVersionConflictError` (novo, análogo a `IllegalTransitionError`, 409 retryable=false). Tactic Bass: **Sanity Checking** (lost-update detection).

- **Resultado Esperado**
  > Escrita concorrente vencida detecta conflito e falha com 409 explícito em vez de sobrescrever silenciosamente. 100% dos updates via versão esperada.

- **Tactic alvo**: Sanity Checking; Comparison
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes de conflito de versão: 0 → ≥2 (write concorrente rejeitado; write com versão correta incrementa)
  - Repositórios respeitando `versao` no WHERE: 0/1 → 1/1
- **Risco de não fazer**: divergência silenciosa entre rateio manualmente editado pelo analista e rateio recomputado pelo coordinator — auditoria vira "quem gravou por último ganhou".
- **Dependências**: nenhuma.

### [fault-tolerance-4] Seedar seam de estorno (`estornarRecebimento`) no coordinator/service

- **Problema**
  > A transição `EXECUTADO → ESTORNADO` existe no guard puro e o DTO expõe `estornadoPor`, mas nenhum arquivo de serviço/repositório da Frente IV tem verbo `estornar`. Teammates da Fase 5 vão implementar o "desfazer" do zero, provavelmente sem o padrão write-ahead (risco de introduzir divergência ledger×ERP na reversão).

- **Melhoria Proposta**
  > Adicionar `estornar(recebimentoId, motivo, ator): Promise<Recebimento>` ao `RecebimentoPipelineService` (ou serviço dedicado `EstornoRecebimentoService`). No scaffold, stubado com `assertTransitionRecebimento(EXECUTADO, ESTORNADO)` + call a um novo port `ErpReversalGatewayInterface.reverter({ borCod, bxaCodSeq })` (stubbed) + `execucaoRepository.markError(idempotencyKey, { erroMensagem: 'estornado por analista' })` ou nova linha de ledger. Documentar a decisão "forward recovery via analista" quando o ERP não expõe undo. Tactic Bass: **Compensating Transaction** / **Rollback**.

- **Resultado Esperado**
  > A transição `EXECUTADO → ESTORNADO` fica exercitada por 1 método stubbed + 1 teste — teammates de Fase 5 preenchem a impl sem inventar padrão. 4/4 transições do state-machine com seam de código.

- **Tactic alvo**: Compensating Transaction; Rollback
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Cobertura de transições do state-machine com seam de código: 1/4 → 4/4
  - Testes: 0 → ≥1 (fluxo executado → estornado stubbed)
- **Risco de não fazer**: quando ocorrer a primeira NDe emitida errado em produção, o analista descobre que a Frente IV não tem botão de estornar — vira ticket no ERP direto, bypassando o ledger.
- **Dependências**: [fault-tolerance-1] (o padrão de try/catch/markError deve estar consolidado antes).

### [fault-tolerance-5] Declarar seams de reconciliação: `listStuckExecucoes` + `ReceivablesReconcilerInterface`

- **Problema**
  > Nenhum job/service prevê comparar `recebimento_execucao.status='settled'` × baixas realmente presentes no `fin010`, nem detectar linhas `reconciling` órfãs (F-fault-tolerance-1 sem detecção). Sem seam declarada agora, teammate de Módulo 5/6 não sabe onde plugar.

- **Melhoria Proposta**
  > Adicionar ao `RecebimentoExecucaoRepositoryInterface`: `listByStatus(status, olderThan?: Date): Promise<RecebimentoExecucaoRow[]>`. Declarar novo port `ReceivablesReconcilerInterface { reconcile(period: NexxeraFetchPeriod): Promise<ReconcileReport> }` + stub. Não implementar o job — só seed do contrato + 1 teste smoke. Tactic Bass: **Reconcile** + **Condition Monitoring**.

- **Resultado Esperado**
  > Módulo 6 sabe exatamente onde plugar o reaper diário (EventBridge alvo). 1 método de query por status + 1 port de reconciliação declarados.

- **Tactic alvo**: Reconcile
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Seams declaradas: 0 → 2 (`listByStatus` + `ReceivablesReconcilerInterface`)
  - Tokens DI: 14 → 15
- **Risco de não fazer**: reaper vira feature-request tardio; enquanto isso, órfãos acumulam sem detecção.
- **Dependências**: nenhuma.

### [fault-tolerance-6] Fortalecer contrato de `MetricsPort.withCorrelationId` (teste de propagação obrigatório)

- **Problema**
  > `MetricsPortStub.withCorrelationId` é pass-through, e o contrato do interface só menciona a obrigação de vincular o correlationId no `logService` como "discipline note" — nada trava. Se Módulo 6 esquecer, os logs downstream perdem rastreabilidade sem quebrar nenhum teste.

- **Melhoria Proposta**
  > Adicionar 1 teste de contrato no `RecebimentoPipelineService.test.ts` que grava chamadas ao `logService` e verifica que **todo** log emitido durante `run()` carrega `qive_id === correlationId`. Documentar no JSDoc do port que impls que não bindarem falham este teste. Tactic Bass: **Condition Monitoring**.

- **Resultado Esperado**
  > Impl real de Módulo 6 sem `logService.setMetadata` dentro do escopo quebra a suite. Rastreabilidade cross-stage garantida por teste, não por convenção.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Testes de propagação de correlationId: 0 → ≥1
- **Risco de não fazer**: primeiro incidente em produção deixa o postmortem sem correlationId em metade dos logs.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo respeitado: julguei apenas os SEAMS do scaffold (write-ahead ledger, guards puros, DI tokens, migração), não a lógica de negócio ausente. Não abri finding para "matcher está stubbed", "nde emitter é fake" etc. — isso é WIP intencional.
- Cross-QA a alertar o consolidator: **[fault-tolerance-1/2]** overlap com qa-availability (recovery de POST + DLQ análogo); **[fault-tolerance-5]** overlap com qa-availability (reaper) e qa-testability (job de reconciliação testável); **[fault-tolerance-6]** overlap com qa-security (auditability — correlationId propagado é parte da trilha de auditoria); **[fault-tolerance-3]** overlap com qa-modifiability (optimistic concurrency é seam contra edições concorrentes).
- Métrica de "reconciliação real vs. ERP" não medível localmente (não há ERP nem CloudWatch nesta bancada); ficou como finding declarativo (F-5).
- Nota positiva não-findable: o padrão de preservação de `settled` na cláusula `ON CONFLICT` (`RecebimentoExecucaoRepository.ts:49-57`) é **exemplar** — copia fielmente o `permuta_alocacao_execucao` e é o coração da promessa de "não duplicar". Se as 6 melhorias forem implementadas, a Frente IV nasce mais dura à falha que a Frente II era ao fim do Regis-Review anterior.
