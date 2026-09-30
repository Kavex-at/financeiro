---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-30-1459-metricas-sispag
agent: qa-fault-tolerance
generated_at: 2026-09-30T15:30:00-03:00
scope: all
score: 8.5
findings_count: 3
cards_count: 2
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao Financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (re-clique) ou retry após falha do Conexos | `settle`/`fail` re-executados sobre a mesma `idempotency_key` de `remessa_execucao`; cron de sincronização (ADR-0055) ainda não rodou, `situacao` = NULL | `remessa_execucao` (ledger anti-duplicação de escrita irreversível), `metricas.metricas_ciclo` | Produção, Render + GH Actions cron, sem scheduler próprio | O carimbo `encerrado_em` não altera `status`/anti-regressão; NULL de `situacao` vira "aguardando retorno" e nunca "rejeitado"; a semana é recalculada quando o aceite chega | 0 alterações de semântica de `settled`; 0 remessas duplicadas; métrica de aceite converge após o 1º sync |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `settle` altera a semântica de `settled`? | Não: `status='settled'` e `WHERE idempotency_key` inalterados; `encerrado_em` só adicionado ao SET (COALESCE, imóvel após o 1º) | 0 mudanças | ✅ | `RemessaExecucaoRepository.ts:173-185` (diff) |
| `beginExecution` preserva `settled` (CASE em status, dry_run, executado_por, identidade) | Intacto, fora do delta | preservar | ✅ | `RemessaExecucaoRepository.ts:85-113` |
| Migração idempotente | `ADD COLUMN IF NOT EXISTS`; backfill com `WHERE encerrado_em IS NULL`; `CREATE OR REPLACE FUNCTION` | re-executável | ✅ | `0070_...sql:38-46` |
| Backfill vs. dados reais | 10 linhas (6 settled, 4 error); as 6 settled têm `atualizado_em` a segundos de `criado_em` (exato) | exato | ✅ | cabeçalho da 0070 (conferido em produção pelo autor; não reexecutado por mim) |
| Reversibilidade documentada | `UPDATE ... SET encerrado_em = NULL` + reaplicar função 0065 | presente | ✅ | `0070_...sql:26-28` |
| Tratamento de `situacao` NULL / `SEM_RETORNO` | NULL e SEM_RETORNO = "aguardando retorno"; fora do numerador, dentro do denominador | não contar como rejeitado | ✅ | `0070_...sql:149-154` |
| Títulos aceitos hoje (baseline de estado) | 0 aceitos de 2 (18–25/09) e 0 de 11 (25/09–02/10) até o cron sincronizar | converge após sync | ⚠️ (esperado, depende do cron) | `_shared-metrics.md` |
| Testes da mudança de ledger | 3 testes, mas verificam o TEXTO do SQL (regex), não o efeito; efeito coberto só nos testes SQL (`p-retentativa`, `s-retentativa` com `encerrado_em` semeado) | efeito real de `settle` | ⚠️ | `RemessaExecucaoRepository.test.ts:146-178`, `vwMetricasCiclo.integration.test.ts:371-397` |
| `fail` protegido contra linha `settled` | Não; `status='error'` incondicional (PRÉ-EXISTENTE) | guarda `status <> 'settled'` | ⚠️ pré-existente | `RemessaExecucaoRepository.ts:199-210` |
| Job reaper de stuck-state / reconciliação Conexos | ⚠️ Não medível neste delta (fora do escopo) | — | n/a | — |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Idempotent Replay | `encerrado_em` no `settle` usa `COALESCE`: re-`settle` não move a data; `beginExecution` já retornava `alreadySettled` | ✅ presente | `RemessaExecucaoRepository.ts:182-183` |
| Sanity Checking | NULL de `situacao` tratado explicitamente; execução `error` e lote CANCELADO excluídos do denominador | ✅ presente | `0070_...sql:9-16,149-154` |
| Timestamp | `encerrado_em` distingue "encerrou" de "última atualização"; corrige o ruído do re-clique em `atualizado_em` | ✅ presente | `0070_...sql:18-24` |
| Reconcile | Série recalculada quando o aceite chega (semana da geração); depende do cron ADR-0055 | ⚠️ parcial | `0070_...sql:12-16` |
| Rollback | Reversão manual documentada (UPDATE + função 0065); não automática | ⚠️ parcial | `0070_...sql:26-28` |
| Repair State | `fail` seguido de retry que liquida sobrescreve `encerrado_em` (último encerramento vence) | ✅ presente | `RemessaExecucaoRepository.ts:207` |
| Compensating Transaction | N/A: o delta é só leitura/métrica; nenhuma escrita no Conexos foi adicionada | N/A | — |
| Quarantine | N/A no delta (sem novo fluxo de exceção) | N/A | — |
| Condition Monitoring | Não há alerta de "sync não rodou": a métrica de aceite fica silenciosamente em 0% (ver F-fault-tolerance-2) | ⚠️ parcial | `_shared-metrics.md` |

## 4. Findings (achados)

### F-fault-tolerance-1: Efeito de `settle`/`fail` sobre `encerrado_em` testado só por regex do SQL no unit test

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (verificação do efeito, não do texto)
- **Localização**: `src/backend/domain/repository/sispag/RemessaExecucaoRepository.test.ts:146-178`
- **Evidência (objetiva)**:
  ```
  expect(sql).toMatch(/encerrado_em = CASE WHEN status = 'settled'\s+THEN COALESCE\(encerrado_em, now\(\)\) ELSE now\(\) END/)
  ```
  A semântica depende de o `status` à direita do SET ser o valor ANTERIOR (verdadeiro em Postgres), mas nenhum teste executa `settle` duas vezes contra Postgres real e afirma que `encerrado_em` não anda. O test:sql semeia `encerrado_em` por INSERT e não passa pelo repositório.
- **Impacto técnico**: uma refatoração do SQL que preserve o regex mas mude o efeito (ou uma troca de ordem no SET) passaria verde. Verifiquei por leitura que o SQL atual está correto.
- **Impacto de negócio**: baixo; erro só deslocaria a semana de uma remessa na métrica, sem tocar dinheiro nem o ledger.
- **Métrica de baseline**: 0 de 3 testes novos do repositório exercitam o efeito; 0 dos 10 registros de produção afetados (6 settled com atualizado_em ≈ criado_em).

### F-fault-tolerance-2: Sem sinal quando o cron de sincronização deixa `situacao` em NULL (métrica de aceite fica em 0% sem alarme)

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: `src/backend/migrations/0070_metricas_ciclo_sispag.sql:149-154`; `.github/workflows/sincronizar-lotes-sispag.yml`
- **Evidência (objetiva)**:
  ```
  semana 18–25/09: 2 títulos, 0 aceitos; 25/09–02/10: 11 títulos, 0 aceitos (situacao NULL)
  ```
  Memória do projeto: o cron já ficou cego por Bad Credentials em 23/09 e "run com 0 títulos aparece como success". A escolha de NULL = "aguardando retorno" é correta (não inventa rejeição), mas um sync quebrado é indistinguível de "banco ainda não respondeu".
- **Impacto técnico**: divergência silenciosa entre o painel e a realidade do banco enquanto o cron estiver quebrado. Não perde dados: a série é recalculada quando o sync voltar.
- **Impacto de negócio**: o painel de métricas pode mostrar R$ 0 aceito para valor de fato aceito; a leitura é "aguardando", e não falsa rejeição. Risco de decisão baseada em número atrasado. Só painel; não move dinheiro.
- **Métrica de baseline**: 13 títulos (R$ 10.964,07) com 0 aceitos hoje; idade do dado mais antigo sem `situacao` não é exposta.

### F-fault-tolerance-3: `fail` sobrescreve `status='error'` sem guarda sobre linha `settled` (PRÉ-EXISTENTE)

- **Severidade**: P2 (pré-existente; NÃO introduzido pelo delta; rebaixado por regra de escopo)
- **Tactic violada**: Idempotent Replay / Sanity Checking
- **Localização**: `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts:199-210`
- **Evidência (objetiva)**:
  ```
  UPDATE remessa_execucao SET status = 'error', ... WHERE idempotency_key = $key
  ```
  O único chamador de `fail` na geração (`RemessaService.ts:740`) fica no `catch` depois que `beginExecution` devolveu `alreadySettled`, o que impede o caminho na prática. O delta acrescenta `encerrado_em = now()` neste UPDATE; se algum chamador futuro atingir uma linha `settled`, a regressão de status já existia e passa a arrastar também a data da métrica.
- **Impacto técnico**: defesa em profundidade ausente no ledger; não há caminho conhecido de disparo hoje.
- **Impacto de negócio**: nenhum observado; potencial de regressão de `settled` que reabriria a chance de remessa duplicada se o guard de `beginExecution` fosse contornado.
- **Métrica de baseline**: 0 ocorrências conhecidas; 2 chamadores de `ledger.fail` (RemessaService, ConciliacaoRetornoService).

## 5. Cards Kanban

### [fault-tolerance-1] Cobrir o efeito de `settle`/`fail` sobre `encerrado_em` em Postgres real

- **Problema**
  > Os testes do repositório só conferem o texto do SQL por regex; a propriedade "re-settle não move `encerrado_em`, fail sobrescreve" não é exercitada contra Postgres. A lógica está correta por leitura, mas sem rede de proteção.

- **Melhoria Proposta**
  > Adicionar um caso no suite `test:sql` que chame `settle` duas vezes (e `fail` → `settle`) via `RemessaExecucaoRepository` real e afirme `encerrado_em` e `status`. Tactic: Idempotent Replay. Tocar `vwMetricasCiclo.integration.test.ts` ou novo teste ao lado do repositório.

- **Resultado Esperado**
  > 3 testes de regex → 3 regex + 1 teste de efeito real; efeito de re-settle coberto: 0 → 1 cenário.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - cenários de efeito real de `settle` em teste: 0 → 2
- **Risco de não fazer**: uma refatoração futura desloca semanas da métrica silenciosamente.
- **Dependências**: nenhuma

### [fault-tolerance-2] Sinalizar quando `situacao` fica NULL por mais de N dias (sync do SISPAG parado)

- **Problema**
  > Título enviado com `situacao` NULL conta como "aguardando retorno" indefinidamente; se o cron `sincronizar-lotes-sispag` parar (já ocorreu em 23/09 por credencial), o painel mostra 0% aceito sem alerta. Hoje: 13 títulos, 0 aceitos.

- **Melhoria Proposta**
  > Expor no painel (ou no log do job) a idade do título mais antigo sem `situacao`, e marcar `parcial` ou avisar quando passar de um limiar (ex.: 2 dias úteis). Tactic: Condition Monitoring. Tocar a função `metricas_ciclo` (nova migration) ou o job de sync (falhar quando processar 0 títulos com carteira não vazia).

- **Resultado Esperado**
  > Sync parado detectado em ≤ 1 dia útil (hoje: indetectável pela métrica).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-3 (relacionado por afinidade de defesa em profundidade: adicionar guarda `AND status <> 'settled'` em `fail` pode ir junto, como item pré-existente)
- **Métricas de sucesso**:
  - tempo para detectar sync parado: indefinido → ≤ 1 dia útil
- **Risco de não fazer**: painel exibe aceite atrasado como se fosse real por semanas, sem que ninguém perceba.
- **Dependências**: ADR-0055 (cron de sincronização)

## 6. Notas do agente

- Escopo: só o delta. Provei por leitura que `settle`/`fail`/`beginExecution` não mudam a semântica de `settled` (o `CASE` usa o status anterior; `status='settled'` continua sendo gravado exatamente como antes). Nenhum P0/P1: sem escrita nova em sistema externo, sem baseline numérico de dano.
- Não reexecutei o backfill nem consultei produção; os números vêm do cabeçalho da 0070 e de `_shared-metrics.md`.
- Cross-QA: Testability (F-fault-tolerance-1); Availability/Deployability (cron de sync, F-fault-tolerance-2); F-fault-tolerance-3 é pré-existente e sem card próprio (registrado no card 2 como item opcional).
