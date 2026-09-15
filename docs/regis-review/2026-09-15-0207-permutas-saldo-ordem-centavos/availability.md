---
qa: Availability
qa_slug: availability
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-availability
generated_at: 2026-09-15T02:35:00Z
scope: backend
score: 8.5
findings_count: 6
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta `permutas-saldo-ordem-centavos`)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia clica **Finalizar** num borderô do painel de Permutas logo depois de rodar a última ingestão do dia (ciclo Ingestão a cada ~6h; a próxima cai daqui a 5h50) | O `finalizarBordero` grava `bor_vld_finalizado = 1` no cache **na hora** (`BorderoGestaoService`), mas `permuta_adiantamento.valorPermutar` (`mnyTitPermutar` do ERP) só é relido na próxima ingestão. Já o painel (`GET /permutas/gestao`) e o teto de nova alocação (`AlocacaoPermutasService.alocar`) usam esse `valorPermutar` **agora** | Cache local `permuta_bordero`, tabela `permuta_alocacao_execucao`, serviço novo `SaldoAlocacaoAdiantamentoService`, tela `/permutas` (aba Cross-process e alocação manual) | Produção Render (1 instância `starter`, Postgres/Supabase), leitores concorrentes (o analista, o Cross-process, cron de ingestão) | O saldo restante e o teto de nova alocação **nunca** podem ficar acima do saldo real do ERP (I-Permuta-1 vale sempre — Σ(alocado−consumido) ≤ saldo a permutar). Na dúvida, **subestimar** o saldo (adto some da aba de trabalho mais cedo, ou uma tentativa de alocação legítima falha com `AlocacaoSaldoError`) — nunca super-alocar. A janela de saldo subestimado pós-Finalizar cabe em ≤ 6h (1 ciclo de ingestão) | 0 super-alocações no par (adto, invoice) após Finalizar; 0 saldos negativos exibidos ao analista (o `saldoRestante` do 12860 sai de `−19.257,73` para `30.364,73`); 100% dos 128 adtos com execução `settled`/`parcial` classificam consumo/não-consumo em concordância com o abate do ERP (`|Δ| ≤ USD 0,01`); Δt de rollout (deploy → 1ª ingestão) ≤ 6h |

> **Cenário-limite:** entre o `git push` e a 1ª ingestão pós-deploy (janela ≤ 6h), as linhas antigas de `permuta_bordero.atualizado_em` foram carimbadas com `now()` a cada refresh do cache (código anterior), então ficam **posteriores** ao último `started_at` da ingestão. A guarda de frescor (`b.atualizado_em < r.started_at`) reprova esses consumos → `naoConsumido(al) = valor_alocado` → `saldoRestante = valorPermutar/taxa − Σ valor_alocado` volta ao comportamento antigo (o próprio bug do delta 1 do Fix). Esperado e documentado no ADR §Consequências; a 1ª ingestão pós-deploy zera a janela.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migrations no delta | 0 (delta 100% código) | ≤ 1 sem DDL destrutivo | ✅ | `git diff --stat origin/main..HEAD src/backend/migrations/` (vazio) |
| `ADD CONSTRAINT`/`ALTER TABLE` no delta | 0 | 0 (fora de deploy dedicado) | ✅ | grep -rn `ALTER\|CREATE TABLE` no diff — 0 hits |
| Rollback do delta | `git revert` puro (sem SQL) | reversível sem migração | ✅ | delta são arquivos `.ts` |
| Ground truth AO VIVO (Conexos prod, read-only) | 247 linhas / 0 DIVERGENTE / 6 EXPLICADO / 1 SEM_GROUND_TRUTH | 0 DIVERGENTE não explicado | ✅ | `_shared-metrics.md` §Gates + `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` |
| Testes verdes cobrindo tactics do delta | backend 135 suites/1953 testes; frontend 40 suites/328 | verde | ✅ | `_shared-metrics.md` §Gates |
| Novos testes de repositório para `listConsumosFinalizados` | 120 linhas de teste em `PermutaExecucaoRepository.test.ts` (guarda de frescor + situação-só carimbo) | cobertura ≥ SQL alvo | ✅ | delta `+120` em `PermutaExecucaoRepository.test.ts` |
| Testes puros do `SaldoAlocacaoAdiantamentoService` | 170 linhas (`naoConsumido` × versão × parcial × settled × sem consumo) | cobertura ≥ regra ADR-0046 D3 | ✅ | `SaldoAlocacaoAdiantamentoService.test.ts` |
| Comparação em centavos (`Math.round(v*100)`) na tolerância | presente | evita ruído de FP na fronteira R$1,00 | ✅ | `ToleranciaResiduo.ts:48-49` |
| Módulo em sobrepagamento (`Math.abs(valorAberto)`) no Gate 3 | presente (guarda −R$34.088,65 do doc 4058 continuar `nao-pago`) | não classifica sobrepagamento como pago | ✅ | `ToleranciaResiduo.ts:42-43` |
| Guarda de frescor no `listConsumosFinalizados` (`b.atualizado_em < r.started_at`) | presente | 0 dupla contagem pós-Finalizar antes da próxima ingestão | ✅ | `PermutaExecucaoRepository.ts:200-203` |
| Carimbo `atualizado_em` só avança quando situação muda (`CASE ... IS DISTINCT FROM ...`) | presente em `replaceBorderoCache` **e** em `updateBorderoCacheSituacao` | idem | ✅ | `PermutaExecucaoRepository.ts:580-583, 605-608` |
| Guarda `dry_run = false` no filtro de consumo | presente | rascunhos/testes não abatem saldo | ✅ | `PermutaExecucaoRepository.ts:198` |
| Filtro terminal (`status IN ('settled','parcial')`) | presente, sem cast — `mapConsumo` guarda com `if` explícito | não conta `pending`/`error`/`reconciling` | ✅ | `PermutaExecucaoRepository.ts:199, 629-632` |
| Fallback conservador sem `valor_residual_usd` em `parcial` | retorna `valorAlocado` inteiro (não zero) | subestima saldo (nunca permite super-alocação) | ✅ | `SaldoAlocacaoAdiantamentoService.ts:69` |
| `naoConsumido` filtra por **versão da alocação** (`c.criadoEm ≥ al.atualizadoEm`) | presente | execução de uma versão antiga não abate a versão atual da alocação | ✅ | `SaldoAlocacaoAdiantamentoService.ts:56-61` |
| Fonte ÚNICA da regra "consumida" (Rule 5 do PatternGuardian: "no reimplement") | 1 (`SaldoAlocacaoAdiantamentoService`, usado pelo teto do `alocar` e pelo `saldoRestante` da tela) | 1 | ✅ | `grep -rn "somaNaoConsumidaDoAdiantamento\|somaNaoConsumida" src/backend/domain/service` → 2 chamadores (tela + alocar) |
| Atomicidade das auto-alocações em lote | `criarRascunhosAtomico` reverte parcialmente (best-effort) em falha | tudo-ou-nada | ⚠️ parcial (compensação por `remover` em `try{}catch{}` silencioso) | `AlocacaoPermutasService.ts:414-433` |
| Reconciliação usa `SaldoAlocacaoAdiantamentoService` | ❌ não — segue com `alocacaoRepository.listAtivas()` | teto do POST na baixa consistente com o teto da tela | ⚠️ parcial (F1 do scoping — pré-existente, delta não fecha) | `ReconciliacaoPermutaService.ts:200,215` |
| Timeout em `axios.create` do `ConexosBaseClient` (fan-out da eleição e da alocação) | ausente para os clients Conexos | timeout global explícito | ⚠️ parcial (pré-existente ao delta) | `grep -rn "axios.create.*timeout" src/backend/domain/client/Conexos*` → 0 hits |
| Fila de consumo do read-path (`/permutas/gestao` → `carregarConsumosPorAdiantamento`) | +1 query por request, sem cap explícito | O(N) rows, latência ≤ tela hoje | ⚠️ parcial (cross-QA performance) | `GestaoPermutasService.ts:93` + `PermutaExecucaoRepository.ts:191-206` |

> ⚠️ **Não medível localmente**: (a) duração real da 1ª ingestão pós-deploy que zera a janela de rollout (depende de Render start + cron EventBridge); (b) MTTR observado num rollback via `git revert` (delta é revertível a frio, mas o número real precisa de log Render); (c) latência real de `/permutas/gestao` pós-delta (a query nova é O(exec_settled_parcial), sem plano de query capturado). Requer log Render / `pg_stat_statements` do Supabase.
> ⚠️ **Não medível localmente**: cobertura (`--coverage`) e `npm audit` — desativados por `--quick` (ver `_shared-metrics.md`).
> ⚠️ **Não medível**: métricas de IaC (`terraform plan`, DLQ, alarms) — repositório **não tem `infra/`** (deploy Render + Vercel).

## 3. Tactics — Cobertura no delta

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping / Echo | `GET /health` (pré-existente; delta não regride) | ✅ presente (herdado) | `src/backend/index.ts` |
| Heartbeat | Sem emissor periódico específico do delta | N/A | — |
| Monitor | Pipeline `/health/pipelines` (herdado) | ✅ presente (herdado) | `src/backend/routes/health.ts` |
| Timestamp | `permuta_bordero.atualizado_em` passa a **carimbar mudança de situação**, não refresh — é o insumo da guarda de frescor da ADR-0046 D3 | ✅ presente (fortalecido pelo delta) | `PermutaExecucaoRepository.ts:580-583, 605-608` |
| Sanity Checking | Filtros defensivos em `listConsumosFinalizados` (`dry_run=false`, status terminal, bordero finalizado E não estornado, frescor). `mapConsumo` valida status com `if` (rejeita fora da união, sem cast) | ✅ presente | `PermutaExecucaoRepository.ts:191-211, 629-632` |
| Condition Monitoring | Ground-Truth script `validate-permutas-saldo-ordem-centavos-v1.ts` compara nossa fórmula com o ERP AO VIVO (read-only) por classificação por linha (EXATO/OK_CENTAVO/EXPLICADO/DIVERGENTE) | ✅ presente | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts:1-120` |
| Voting | N/A — 1 instância Render | N/A | — |
| Exception Detection | `SaldoAlocacaoAdiantamentoService.naoConsumido` não engole exceção; `AlocacaoSaldoError` continua sendo lançado com `disponivel` atualizado | ✅ presente | `AlocacaoPermutasService.ts:256-262` |
| Self-Test | Testes puros do serviço reproduzem os casos canônicos (12860 → 30.364,73; 9328 → 39.652,47) sem I/O | ✅ presente | `SaldoAlocacaoAdiantamentoService.test.ts` (170 linhas) |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | Render starter — 1 instância; a nova só fica no ar depois que o boot passa (`healthCheckPath`) | ⚠️ parcial (herdado) | `render.yaml` |
| Passive Redundancy | Instância antiga serve até o cutover do Render | ⚠️ parcial (herdado) | idem |
| Spare | N/A | N/A | — |
| Exception Handling | `criarRascunhosAtomico` (pre-existente) faz try+rollback compensatório; delta preserva | ⚠️ parcial (rollback é best-effort — `try{await remover(...)} catch {}` sem propagação, F-availability-4) | `AlocacaoPermutasService.ts:409-433` |
| Rollback | Delta é 100% código — `git revert` reverte tudo sem SQL de reversão; nenhuma DDL/backfill; nenhuma coluna nova | ✅ presente | `git diff --stat origin/main..HEAD src/backend/migrations/` (vazio) |
| Software Upgrade | Deploy contínuo pelo Render sobre 1 instância; delta **sem migração** ⇒ boot rápido; instância anterior continua no ar até o `/health` passar | ✅ presente (baixo risco vs. delta anterior 2026-09-08 que tocava 152k linhas) | `render.yaml` |
| Retry | `RetryExecutor` no `PostgreeDatabaseClient` (herdado); delta não introduz novo retry — a semântica é "na dúvida não conta" (subestimar), não "tenta de novo" | ✅ presente (herdado) | `PostgreeDatabaseClient.ts` |
| Ignore Faulty Behavior | **REJEITADO no delta**: `naoConsumido` sem `valor_residual_usd` num `parcial` devolve `valorAlocado` inteiro (conservador) em vez de zero ou silêncio; sem coluna do bordero no cache, o consumo **não** é reconhecido (também conservador) — troca "ignorar" por "subestimar saldo" | ✅ presente (revogada onde não devia estar) | `SaldoAlocacaoAdiantamentoService.ts:68-70`; `PermutaExecucaoRepository.ts:195` |
| Degradation | Adto com `mnyTitPermutar ≤ R$1,00` sai da fila `permuta-manual` e vai para `JA_PERMUTADO` — degradação de estado, não de disponibilidade (o adto continua listado, com aba própria); adto com resíduo real > R$1 (5 casos: R$21/327/1.472/1.621/2.175) segue `nao-pago` | ✅ presente | `ElegibilidadeService.ts:96-110` |
| Reconfiguration | N/A | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | O `validate-permutas-saldo-ordem-centavos-v1.ts` é essencialmente uma execução **shadow**: usa a fórmula de produção com insumos vivos do ERP e compara com o abate do ERP, sem escrever nada | ✅ presente | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` |
| State Resynchronization | O `valorPermutar` do ERP é a fonte de verdade; a próxima ingestão relê e reconcilia. A guarda de frescor **é** o mecanismo de resincronização determinística por deploy | ✅ presente | `PermutaExecucaoRepository.ts:196-203` |
| Escalating Restart | Herdado (`process.exit(1)` no `start().catch`) | ⚠️ parcial (herdado) | `src/backend/index.ts` |
| Non-Stop Forwarding | N/A (Express, 1 instância) | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Delta sem migration ⇒ sem janela de indisponibilidade extraordinária no deploy; herdado do template | ✅ presente | delta 0 migrations |
| Transactions | UPSERT do borderô cache com `ON CONFLICT ... DO UPDATE SET ... CASE WHEN IS DISTINCT ...` mantém atomicidade de mudança de situação; escritas de alocação seguem em transação (herdado) | ✅ presente | `PermutaExecucaoRepository.ts:570-585` |
| Predictive Model | O `naoConsumido` é essencialmente um **modelo determinístico** de "vai ser abatido pelo ERP?" a partir do status do borderô — não preditivo por estatística; ground truth valida 247/247 linhas em concordância com o ERP | ⚠️ parcial (determinístico, não preditivo) | `SaldoAlocacaoAdiantamentoService.ts:52-71` |
| Exception Prevention | Comparação em CENTAVOS (`Math.round(v*100)`) elimina fronteira de ponto-flutuante em R$1,00. `Math.abs(valorAberto)` no Gate 3 impede que sobrepagamento negativo grande (-R$34.088,65 do doc 4058) seja lido como "≤ R$1,00 ⇒ pago" | ✅ presente | `ToleranciaResiduo.ts:42-49` |
| Increase Competence Set | A regra "consumida ⇔ real + terminal + bordero finalizado e vivo + carimbado antes desta ingestão" está agora explicitamente no domínio (`SaldoAlocacaoAdiantamentoService`), documentada, testada, e é a **fonte única** consumida pela tela e pelo teto do `alocar` | ✅ presente | `SaldoAlocacaoAdiantamentoService.ts` (docblock + 108 LOC) |

## 4. Findings

### F-availability-1: Janela de rollout — a guarda de frescor só passa a ter efeito depois da 1ª ingestão pós-deploy (≤ 6h)

- **Severidade**: P2 (médio — documentada no ADR §Consequências; direção conservadora, sem risco de super-alocação; simplesmente adia o benefício do fix por 1 ciclo de ingestão)
- **Tactic violada**: State Resynchronization (parcial — a resincronização acontece, mas com latência determinística)
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:191-206` (a query) + `:580-583, 605-608` (o novo carimbo em `atualizado_em`)
- **Evidência (objetiva)**:
  ```
  b.atualizado_em < r.started_at            -- guarda de frescor
  JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id
  ```
  Todas as linhas de `permuta_bordero` que existirem no momento do deploy tiveram `atualizado_em` renovado pelo comportamento anterior a cada `replaceBorderoCache` (a cada refresh, incluindo o botão "Atualizar" da tela). A `last_ingest_run_id.started_at` de qualquer adto é a hora da última ingestão bem-sucedida antes do deploy. Se a linha do cache foi tocada em qualquer refresh depois desse `started_at` (comum), o filtro `b.atualizado_em < r.started_at` a exclui, e `listConsumosFinalizados` **não** classifica as execuções desse borderô como consumidas. Efeito: `saldoRestante` segue com o comportamento antigo (double-count) até que a 1ª ingestão pós-deploy rode e (a) carimbe um `last_ingest_run_id.started_at` mais recente que o `atualizado_em` do cache (que só avança se a situação mudar de fato) e (b) releia `mnyTitPermutar` do ERP.
- **Impacto técnico**: por ≤ 6h após o deploy, os 128 adtos com execução real `settled`/`parcial` continuam com o `saldoRestante` do bug antigo (12860 = −19.257,73; 9328 = 4.304,94). Adtos que já eram bug hoje continuam bug até a próxima ingestão. **Nenhum adto novo é bugado por causa do deploy.**
- **Impacto de negócio**: latência de 1 ciclo de ingestão (≤ 6h) para o analista ver o `saldoRestante` corrigido no painel. Não bloqueia trabalho — o adto 9328 já era manualmente destravado no ERP; o 12860 continua saindo da aba Cross-process como já sai hoje.
- **Métrica de baseline**: `SELECT COUNT(*) FROM permuta_bordero WHERE atualizado_em > (SELECT max(started_at) FROM permuta_eleicao_run WHERE status='success')` — proxy da fração de rows na janela; não medível deste worktree (requer PRD Postgres). Δt esperado = período do cron de ingestão (~6h por scoping A3).

### F-availability-2: `ReconciliacaoPermutaService` continua computando saldo do adto por `alocacaoRepository.listAtivas()` — não usa a fonte única `SaldoAlocacaoAdiantamentoService` (F1 do scoping, pré-existente)

- **Severidade**: P2 (médio — pré-existente; delta não regride nem fecha; documentado em `tasks.md` A2/F1)
- **Tactic violada**: Consistency (parte de State Resynchronization) — dois pontos do sistema (tela e teto do `alocar` vs. POST da baixa) usam definições diferentes de "quanto do adto já foi consumido"
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:200, 215` (`await this.alocacaoRepository.listAtivas()`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "somaNaoConsumidaDoAdiantamento\|carregarConsumosPorAdiantamento" src/backend/domain/service/permutas/
  src/backend/domain/service/permutas/AlocacaoPermutasService.ts:252
  src/backend/domain/service/permutas/GestaoPermutasService.ts:93
  # ReconciliacaoPermutaService: 0 hits
  ```
  A baixa (`reconciliarSerializado`) lê o adto direto do banco (`findAdiantamento`) e não relê `getDetalheTitulos` ao vivo; portanto opera sobre o snapshot da última ingestão. O teto do adto no POST vem, na prática, da invoice (cap por invoice + `borderoDoPar` bloqueando re-alocação já usada) e do `valorPermutar` snapshot — não da regra `naoConsumido` da tela.
- **Impacto técnico**: se, por qualquer motivo, a tela e o `alocar` disserem "cabe R$ X" e o POST da baixa disser "cabe R$ Y" (X ≠ Y), o analista pode ver um `AlocacaoSaldoError` inconsistente entre "tentar alocar" e "baixar". Hoje não há evidência de que isso ocorra — os caps de invoice + `borderoDoPar` cobrem, e o `valorPermutar` do snapshot já é o abatido do ERP — mas a **regra** não é única.
- **Impacto de negócio**: baixo (as travas de invoice + `borderoDoPar` impedem super-baixa efetiva); porém, se um dia o teto de alocação da tela subir por causa do fix D3 (adto 9328 volta a `39.652,47`) e a reconciliação continuar operando com uma noção antiga de "usado", a semântica pode divergir. A ontologia esperava fonte única (ADR-0046 §Decisão / D3).
- **Métrica de baseline**: 2 callsites de `alocacaoRepository.listAtivas()` na reconciliação; 0 callsites de `SaldoAlocacaoAdiantamentoService` na reconciliação; 2 callsites nas leituras (tela + `alocar`).

### F-availability-3: Nova query full-scan `listConsumosFinalizados()` (sem `adtoDocCod`) roda a cada `GET /permutas/gestao`, sem cap

- **Severidade**: P2 (médio — cross-QA performance; escala atual (~128 execuções `settled`/`parcial`) é confortável, mas não há LIMIT nem paginação)
- **Tactic violada**: Removal from Service (parcial — read-path novo pode virar gargalo silencioso)
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:93` (chamador) + `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211` (SQL alvo)
- **Evidência (objetiva)**:
  ```
  SELECT ... FROM permuta_alocacao_execucao e
    JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
    JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod
    JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id
   WHERE e.dry_run = false
     AND e.status IN ('settled', 'parcial')
     AND b.bor_vld_finalizado = 1
     AND b.bor_cod_estornado IS NULL
     AND b.atualizado_em < r.started_at
     AND ($adtoDocCod::text IS NULL OR e.adiantamento_doc_cod = $adtoDocCod)
   ORDER BY e.adiantamento_doc_cod, e.criado_em
  ```
  Executado sem `$adtoDocCod` em `exporGestao` (uma query para o painel inteiro — decisão explícita do serviço). Sem LIMIT. `permuta_alocacao_execucao` cresce monotonicamente (auditoria — cada tentativa de baixa deixa linha).
- **Impacto técnico**: hoje (~128 execuções + 250 runs) é rápido. Em 12–24 meses (estimativa: 30–50 execuções/mês → 400–800 execuções/ano), a query segue barata mas o custo linear cresce a cada request do painel — que é polido a cada `useSWR` do frontend. Sem índice explícito em `(dry_run, status, bor_vld_finalizado)` além do implícito por PK/FK.
- **Impacto de negócio**: potencial degradação lenta e silenciosa do painel (perceptível como "tela lenta ao abrir Permutas"); nada quebra.
- **Métrica de baseline**: 1 query nova por request de `/permutas/gestao`; 0 índices dedicados citados no delta; universo atual da baixa: 128 execuções `settled`/`parcial` (evidência da entrevista).

### F-availability-4: Rollback compensatório de `criarRascunhosAtomico` é best-effort silencioso (pré-existente, delta não regride)

- **Severidade**: P2 (médio — pré-existente; delta não introduz nem piora; registrado por completude da tactic Exception Handling)
- **Tactic violada**: Exception Handling (parcial — a compensação existe, mas a falha da compensação é silenciada com `// best-effort`)
- **Localização**: `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:414-433`
- **Evidência (objetiva)**:
  ```typescript
  for (const invoiceDocCod of criadas) {
      try {
          await this.remover(adiantamentoDocCod, invoiceDocCod);
      } catch {
          // best-effort: a baixa ainda relê em-aberto vivo e capa por invoice.
      }
  }
  ```
  O `remover` pode falhar por, por exemplo, `AlocacaoEmBorderoError` — se, entre o `upsertAlocacao` e a compensação, a mesma sessão (ou outra) tiver lançado um borderô sobre a linha, a compensação **falha silenciosamente** e a alocação parcial fica no banco. A defesa que o comentário cita (invoice cap + `borderoDoPar`) é válida, mas move a captura para o próximo passo do fluxo em vez de garantir all-or-nothing.
- **Impacto técnico**: possibilidade de rascunho parcial persistido em caso de falha na auto-alocação em lote de uma múltipla com muitas invoices. A janela é estreita (mesmo tick do event loop).
- **Impacto de negócio**: pequeno — o próximo `alocar`/`Baixar` do analista reencaixa; o próprio comentário do código descreve a rede de segurança do fluxo seguinte.
- **Métrica de baseline**: 1 `catch {}` silencioso na compensação; 0 log/telemetria adicional dentro do `catch`.

### F-availability-5 (positivo, registrado): Delta é 100% código, sem migração, sem lock — deploy zero-downtime; rollback via `git revert` puro

- **Severidade**: P3 (informativo)
- **Tactic**: Software Upgrade + Rollback (fortalecidos vs. o delta anterior 2026-09-08, que tocava 152k linhas com `ADD CONSTRAINT CHECK` sem `lock_timeout`)
- **Localização**: `git diff --stat origin/main..HEAD src/backend/migrations/` (vazio); todos os 27 arquivos de src são `.ts`
- **Evidência (objetiva)**:
  ```
  $ git -C . diff --name-only origin/main..HEAD | grep -E 'migrations/|\.sql$'
  (vazio)
  ```
  Nenhum `ALTER TABLE`, nenhum `ADD CONSTRAINT`, nenhuma DDL. Nada bloqueia o boot da nova instância além do que já bloqueia hoje. `render.yaml` inalterado.
- **Impacto técnico**: janela de deploy pequena e previsível; MTTR de reversão semântica = tempo de `git revert HEAD~N && push` + 1 ciclo de deploy (Render autoDeploy).
- **Impacto de negócio**: nulo — direção positiva. Cabe registrar que o card `availability-2` do run 2026-09-08 (rollback script para 0054) continua aberto naquele contexto, mas **não** se aplica a este delta.
- **Métrica de baseline**: 6 commits no delta; 0 SQL modificado; 0 DDL nova; 100% código TypeScript e Markdown.

### F-availability-6 (positivo, registrado): Ground-Truth Validator AO VIVO (read-only, 247 linhas / 0 DIVERGENTE) prova que a fórmula bate com o abate do ERP

- **Severidade**: P3 (informativo)
- **Tactic**: Sanity Checking + Condition Monitoring + Shadow (o script é um "shadow" de produção sobre insumos vivos)
- **Localização**: `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (736 linhas)
- **Evidência (objetiva)**: registrado em `_shared-metrics.md` — 247 linhas verificadas, 0 DIVERGENTE, 6 EXPLICADO, 1 SEM_GROUND_TRUTH (fronteira R$1,00/1,01 sem doc real). O script importa `ToleranciaResiduo`, `ElegibilidadeService.avaliarElegibilidade`, `SaldoAlocacaoAdiantamentoService.naoConsumido/somaNaoConsumida` de produção (não reimplementa a regra) e recusa PRD sem `PROBE_ALLOW_PRD=1` (`validate-permutas-saldo-ordem-centavos-v1.ts:59-62`).
- **Impacto técnico**: alta confiança de que o comportamento pós-deploy não regride semanticamente contra a fonte de verdade.
- **Impacto de negócio**: reduz risco de "descobrir um DIVERGENTE em prod, no dia de fechamento".
- **Métrica de baseline**: 247 linhas de comparação; 0 DIVERGENTE não explicado; cobertura dos 3 grupos de decisão (D1 tolerância, D2 prioridade, D3 saldo).

## 5. Cards Kanban

### [availability-1] Documentar e observar a janela de rollout do fix D3

- **Problema**
  > Por até 6h após o deploy (1 ciclo da ingestão de Permutas), as linhas antigas do cache `permuta_bordero` têm `atualizado_em` renovado pelo comportamento anterior a cada refresh, então a guarda de frescor (`b.atualizado_em < r.started_at`) as reprova e `saldoRestante` segue o comportamento antigo (double-count). É a direção conservadora prevista no ADR (F-availability-1), mas sem observabilidade o time só saberia consultando o Postgres.

- **Melhoria Proposta**
  > (i) Runbook em `docs/runbooks/permutas-saldo-ordem-centavos-rollout.md` explicando a janela e como acompanhá-la (query `SELECT max(started_at) FROM permuta_eleicao_run WHERE status='success'` vs. `SELECT count(*) FROM permuta_bordero WHERE atualizado_em > $started`). (ii) Log estruturado (LogService.info `permuta gestao served`) já existe em `GestaoPermutasService.ts:211-220` — acrescentar contagem de adtos com `alocacoes.length>0 AND saldoRestante < 0` para monitorar o encolhimento da janela. Tactic Bass alvo: **Condition Monitoring** durante rollout.

- **Resultado Esperado**
  > (a) `# adtos com saldoRestante < 0` no log do painel → cai a zero até a 1ª ingestão pós-deploy; (b) time sabe quando a janela fechou sem precisar abrir o Supabase. Métrica: `count(saldoRestante < 0) na 1ª ingestão` → 0.

- **Tactic alvo**: Condition Monitoring; State Resynchronization
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Presença do runbook: 0 → 1
  - Campo `saldosNegativosNoPainel` no log info `permuta gestao served`: 0 → 1 (novo)
  - Tempo até janela fechar (deploy → 1ª ingestão): não observável → observável em log
- **Risco de não fazer**: analista abre chamado dentro da janela ("meu 12860 continua −R$ 19 mil"), time perde ciclo debugando algo que era esperado.
- **Dependências**: nenhuma.

### [availability-2] Unificar o teto do adto na reconciliação com `SaldoAlocacaoAdiantamentoService`

- **Problema**
  > `ReconciliacaoPermutaService` (`:200, :215`) lê `alocacaoRepository.listAtivas()` diretamente e soma `valor_alocado` para calibrar o teto — a regra "não descontar consumido do ERP" da ADR-0046 D3 vive na tela e no `alocar`, mas **não** na baixa. Pré-existente, delta não amplia (F1 do scoping / F-availability-2); porém, agora que a ontologia dita fonte única, ficar com duas fontes vira dívida ativa.

- **Melhoria Proposta**
  > Trocar `alocacaoRepository.listAtivas().filter(...)` no `reconciliarSerializado` por `SaldoAlocacaoAdiantamentoService.somaNaoConsumidaDoAdiantamento(adtoDocCod)`. Manter o `borderoDoPar` como trava de integridade (não é sobre saldo, é sobre re-uso de baixa). Tactic Bass alvo: **State Resynchronization** (fonte única do "quanto já foi consumido").

- **Resultado Esperado**
  > 1 fonte de saldo consumida por 3 callers (tela, `alocar`, `reconciliar`) — hoje é 1 fonte para 2 callers e outra fonte para 1 caller. Métrica: `grep -c "somaNaoConsumida" src/backend/domain/service/permutas/*.ts` → 2 → 3; `grep -c "alocacaoRepository.listAtivas()" src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` → 2 → 0.

- **Tactic alvo**: State Resynchronization; Increase Competence Set
- **Severidade**: P2
- **Esforço estimado**: M (recompor mocks dos testes de ReconciliacaoPermutaService — 20+ setups fazem `alocacaoRepository.listAtivas = jest.fn()...`)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Callers de `somaNaoConsumidaDoAdiantamento`: 2 → 3
  - Callers de `alocacaoRepository.listAtivas` na reconciliação: 2 → 0 (ou justificado)
- **Risco de não fazer**: divergência silenciosa entre "cabe R$ X (tela)" e "cabe R$ Y (POST da baixa)" quando a semântica de "consumido" evoluir novamente.
- **Dependências**: nenhuma (o serviço já está injetado no container).

### [availability-3] Botar cap/paginação e índice na query nova de `listConsumosFinalizados`

- **Problema**
  > `GET /permutas/gestao` ganhou uma query nova (`carregarConsumosPorAdiantamento`) que faz full-scan de `permuta_alocacao_execucao ⋈ permuta_bordero ⋈ permuta_adiantamento ⋈ permuta_eleicao_run` a cada chamada, sem LIMIT nem índice dedicado (F-availability-3). Escala confortável hoje (~128 rows), mas cresce O(execuções) — a tabela é apend-only de auditoria.

- **Melhoria Proposta**
  > (i) Criar índice dedicado em `permuta_alocacao_execucao (dry_run, status, adiantamento_doc_cod)` (uma migration nova, sem lock — `CREATE INDEX CONCURRENTLY`). (ii) Considerar retornar só as execuções **ativas por adto ativo** (`INNER JOIN` em `permuta_adiantamento a WHERE NOT a.stale`) — já feito indiretamente pelo JOIN por `last_ingest_run_id`, mas explícito ajuda o planner. Tactic Bass alvo: **Predictive Model** (planejar o crescimento antes da dor).

- **Resultado Esperado**
  > Latência de `/permutas/gestao` estável em regime de 5× o volume atual. Métrica: adicionar `pg_stat_statements` para a query nova; medir `mean_exec_time` antes/depois.

- **Tactic alvo**: Predictive Model; Removal from Service (bounded)
- **Severidade**: P2
- **Esforço estimado**: S (uma migration nova + `CREATE INDEX CONCURRENTLY`)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Existência do índice: não → sim
  - `mean_exec_time` da query nova em `pg_stat_statements` (baseline PRD): não medível → medível
- **Risco de não fazer**: em 12–24 meses, `/permutas/gestao` fica lento sem sinal claro; o painel é a tela mais aberta pelos analistas.
- **Dependências**: nenhuma (index concurrent é migration segura).

## 6. Notas do agente

- Escopo: **delta**, não repo. Não re-levantei P0/P1 sobre `lock_timeout`/`NOT VALID` (F-availability-1 do run 2026-09-08) porque este delta **não tem migração** — o risco lá era da 0054, não deste `fix/permutas-saldo-ordem-centavos`. O card `availability-1` daquele run segue aberto no seu inbox.
- Nota positiva mais estrutural do delta: a **guarda de frescor** (`b.atualizado_em < r.started_at`, com o carimbo em `atualizado_em` só mudando quando a situação muda) é uma tática de **State Resynchronization por desenho**, que substitui a "janela de ≤ 6h aceita" da entrevista por uma janela **determinística** e conservadora. Combinada com o `Math.abs(valorAberto)` no Gate 3 e o `Math.round(v*100)` da fronteira, o delta é notavelmente bem defendido contra a família de bugs que ele fecha.
- Cross-QA: **performance** herda o card `availability-3` (query nova sem cap); **fault-tolerance** herda o card `availability-2` (fonte única do saldo consumido) e o registro positivo F-availability-6 (Ground Truth); **modifiability** herda a nota positiva sobre a fonte única (`SaldoAlocacaoAdiantamentoService`) e o débito da reconciliação.
- Não medível localmente: latência real do read-path pós-delta, MTTR do rollback, tempo até 1ª ingestão pós-deploy fechar a janela — todos exigem log Render / `pg_stat_statements` do Supabase.
