---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-28-1534
agent: qa-fault-tolerance
generated_at: 2026-09-28T15:50:00-03:00
scope: backend
score: 8.0
findings_count: 3
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/serviço reexecuta uma permuta ou SN que falhou antes (mesma `idempotency_key`) | `markError` → retry via `beginExecution` → dias/semanas depois, `markSettled`/`markParcial` | `permuta_alocacao_execucao` / `solicitacao_numerario_execucao` (ledger write-ahead) + `metricas.metricas_ciclo` (0064) | Operação normal, fora de uma janela de deploy | O ledger nunca duplica a baixa no `fin010` (idempotência preservada) **e** a métrica atribui a execução à semana em que ela **realmente terminou**, não à da 1ª tentativa nem a uma tentativa intermediária | 0 baixas duplicadas; discrepância entre número publicado e estado real do ledger dentro da tolerância medida pela query de validação (o caso corrigido por este delta era 2 linhas / R$ 503.066,69) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Repositórios de escrita financeira tocados pelo delta com idempotência preservada | 2/2 (100%) | 100% | ✅ | `PermutaExecucaoRepository.ts`, `SolicitacaoNumerarioExecucaoRepository.ts` (diff) |
| Atomicidade da migration 0064 | 1 arquivo, 1 transação, advisory lock | 100% | ✅ | `runMigrations.ts:141` (shared-metrics) |
| Linhas afetadas pelo backfill | ~190 (permuta + SN) | < 1.000 (limiar de script de rollback) | ✅ | `migrations/rollbacks/README.md`, shared-metrics |
| Testes de integração do delta (Postgres real) | 24/24 (5 novos: retentativa permuta, retentativa SN, re-clique, backfill, contrato) | 100% verde | ✅ | `vwMetricasCiclo.integration.test.ts` |
| Testes de integração que exercitam `markSettled`/`markParcial`/`markError` (repositório) contra Postgres real **com** o trigger 0057 ativo | 0 | ≥ 1 por escrita terminal | ❌ | `grep` em `*.integration.test.ts` (nenhum resultado) — ver F-fault-tolerance-2 |
| Verificação empírica manual (fora do repo) de que o `CASE WHEN status …` do SET lê o valor ANTIGO da linha, e que o trigger 0057 não bloqueia o caminho legítimo | Confirmado 1/1 (docker `postgres:17-alpine` local) | Codificado em teste | ⚠️ | Sessão desta revisão, não persistido como teste |
| Reabertura de execução com falha anterior deixa `encerrado_em` não-nulo (stale) numa linha agora "em voo" | Reproduzido 1/1 em ambiente local | 0 (contradiz a doc do ADR-0051) | ⚠️ | Reprodução manual — ver F-fault-tolerance-1 |
| Baseline do bug que a ADR-0051 corrige (pré-fix) | 2 linhas / R$ 503.066,69 em 190 linhas (medido 18/09) | 0 | ✅ (fix aplicado) | `ontology/decisions/0051-…md`, `0064…sql` comentário |
| Viés residual do backfill pós-fix para linhas terminais re-clicadas antes da 0064 | Não medível nesta sessão | 0 | ⚠️ **Não medível localmente** | leitura de produção negada; consulta pronta em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |

> ⚠️ **Não medível localmente**: contagem real de linhas em produção que hoje estão `reconciling`/`pending` após uma falha anterior (candidatas ao F-1), e contagem de linhas terminais que ainda carregam o viés do backfill (F-3). Requer acesso de leitura ao Postgres de produção, negado nesta sessão. Recomendação: rodar a query de `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` e anexar ao card F-3.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — delta não introduz redundância de componente | N/A | — |
| Replacement | N/A | N/A | — |
| Predictive Model | N/A | N/A | — |
| Increase Competence Set | ADR-0051 (D2) cataloga TODAS as escritas que tocam `status`/`encerrado_em` (tabela "Escrita → Carimbo"), mas não analisa o caminho `beginExecution` reabrindo uma linha `error` | ⚠️ parcial | `ontology/decisions/0051-…md` D2; ver F-1 |
| Sanity Checking | Teste de contrato garante que a 0064 não altera as 11 colunas da função nem as 9 da view | ✅ presente | `vwMetricasCiclo.integration.test.ts` — "a 0064 não altera o contrato" |
| Comparison | Migration documenta o antes/depois numérico (R$ 0,00 → R$ 150.061,81) e deixa consulta de validação para conferência externa | ✅ presente | `0064…sql` cabeçalho; `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` |
| Timestamp | É o mecanismo central do delta: `encerrado_em` substitui `criado_em` como fonte de verdade temporal para corrigir atribuição de semana | ✅ presente | `0064…sql:70` (`COALESCE(encerrado_em, criado_em)`) |
| Timeout | Fora do escopo do delta (lógica de `EXECUCAO_INTERROMPIDA_MINUTOS` pré-existente, não tocada) | N/A | `SolicitacaoNumerarioExecucaoRepository.ts:~283` (não alterado) |
| Condition Monitoring | Nenhum monitor detecta uma linha `reconciling`/`pending` com `encerrado_em` não-nulo (estado que a própria ADR-0051 considera inválido: "linha em voo não tem encerrado_em") | ⚠️ parcial | Ver F-1 |
| Self-Test | 24 testes de integração + 21 testes de guarda estática contra Postgres real cobrindo a 0064 | ✅ presente | shared-metrics; `vwMetricasCiclo.test.ts` |
| Voting | N/A | N/A | — |
| Redundancy | N/A — delta não move dado entre réplicas | N/A | — |
| Recovery (forward/backward) | Forward: retry após `markError` (pré-existente). Backward: rollback documentado e reversível da própria migration (`SET encerrado_em = NULL` / `DROP COLUMN`) | ✅ presente | `0064…sql:28-33` |
| Reintroduction (Shadow/Resync/Escalating Restart) | N/A para este delta | N/A | — |
| Rollback | Migration roda em transação própria com advisory lock; rollback documentado no cabeçalho da 0064 | ✅ presente | `runMigrations.ts:141`; `0064…sql:28-33` |
| Repair State | Backfill (`UPDATE … WHERE encerrado_em IS NULL`) repara o histórico existente com a melhor aproximação disponível, declarada como tal | ✅ presente (com viés residual conhecido) | `0064…sql:58-66`; ver F-3 |
| Idempotent Replay | Migration idempotente (`ADD COLUMN IF NOT EXISTS`, backfill só onde NULL, `CREATE OR REPLACE`); reaplicação coberta por teste dentro de transação desfeita; escritas `markSettled`/`markParcial` confirmadas idempotentes sob dupla invocação (verificação manual) | ✅ presente | `0064…sql`; `vwMetricasCiclo.integration.test.ts` — "reaplicar a migration é no-op"; verificação manual desta sessão |
| Compensating Transaction | N/A — delta não escreve no Conexos, só no read-model/ledger local | N/A — decisão correta (nada a compensar) | — |
| Reconcile | Consulta de validação manual existe, mas não roda automaticamente nem foi executada nesta sessão | ⚠️ parcial | `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`; ver métricas §2 |
| Quarantine | N/A para este delta | N/A | — |

## 4. Findings (achados)

### F-fault-tolerance-1: `beginExecution` reabre execução com falha anterior sem limpar o `encerrado_em`, violando a invariante "linha em voo" da própria ADR-0051

- **Severidade**: P2
- **Tactic violada**: Repair State / Condition Monitoring
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:366-406` (`beginExecution`, não tocado pelo delta) interagindo com `:439-457` (`markSettled`) e `:527-541` (`markError`); `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:83-130` (`beginExecution`) e `:308-360`; `ontology/decisions/0051-…md` D1 ("linha em voo… continua na semana em que nasceu") e D2 ("qualquer outra [escrita] | não toca")
- **Evidência (objetiva)**: reproduzido em Postgres 17 local — uma linha `error` com `encerrado_em` de uma falha anterior, ao ser reaberta pelo `UPDATE` equivalente ao `ON CONFLICT DO UPDATE` de `beginExecution`, fica `status='reconciling'` com `encerrado_em` **inalterado** (não-nulo):
  ```
   k |   status    |      encerrado_em      |         atualizado_em
  ---+-------------+------------------------+-------------------------------
   a | reconciling | 2026-08-01 10:00:00+00 | 2026-09-28 15:39:43.136755+00
  ```
  `beginExecution` não lista `encerrado_em` no `SET` (confirmado pelo teste `re-clique (beginExecution) e demais escritas não mexem em encerrado_em`), então uma linha `error` reaberta carrega o carimbo da falha anterior enquanto está genuinamente em andamento.
- **Impacto técnico**: enquanto o retry está em curso, `metricas.metricas_ciclo` atribui a linha à semana da falha anterior (via `encerrado_em` não-nulo) em vez de tratá-la como "em voo" — contradiz a doc do próprio ADR-0051. Ao concluir (settle ou nova falha), o carimbo é sobrescrito e a métrica se autocorrige (`markSettled`/`markError` sempre gravam `now()` quando `status` antigo não é terminal) — o efeito é transitório, não permanente, e não duplica nenhuma escrita no ERP.
- **Impacto de negócio**: se o report semanal for lido durante essa janela de retry ativo, uma tentativa em andamento pode aparecer como "fechada" numa semana passada — o mesmo tipo de distorção que motivou a ADR-0051 (R$ 503 mil no caso original), numa forma mais estreita e transitória.
- **Métrica de baseline**: reproduzido 1/1 em ambiente isolado; contagem real de linhas em produção hoje nessa condição não é medível nesta sessão (leitura de produção negada). Por ausência de número de produção, rebaixado de P1 para **P2** (regra do template, item 7).

### F-fault-tolerance-2: a interação entre a escrita de `encerrado_em` e o trigger `permuta_execucao_bloqueia_reabertura` (0057) não é exercitada por nenhum teste automatizado contra Postgres real

- **Severidade**: P2
- **Tactic violada**: Self-Test / Condition Monitoring
- **Localização**: `src/backend/migrations/vwMetricasCiclo.integration.test.ts` (semeia os ledgers via `INSERT` direto, nunca chama `PermutaExecucaoRepository`/`SolicitacaoNumerarioExecucaoRepository`); `src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts` (+50 linhas do delta — mocks de `jest`, asserção por regex na string SQL, sem Postgres real)
- **Evidência (objetiva)**: `grep -rln "PermutaExecucaoRepository\|SolicitacaoNumerarioExecucaoRepository" src/backend/**/*.integration.test.ts` não retorna nenhum arquivo. A suíte que roda contra Postgres real (`vwMetricasCiclo.integration.test.ts`, que aplica a migration 0057 do trigger) nunca chama os métodos do repositório — só insere linhas já com `encerrado_em` definido via SQL cru. Confirmei manualmente, fora da suíte (docker `postgres:17-alpine`), que o `CASE WHEN status IN (...)` no `SET` lê o valor **antigo** da linha (semântica padrão do Postgres) e que o trigger 0057 não bloqueia o caminho legítimo de `markSettled`/`markParcial`/`markError` — mas essa prova não está codificada em nenhum teste do repositório.
- **Impacto técnico**: uma futura alteração no formato do `UPDATE` (reordenar colunas do `SET`, trocar para um query builder que gere SQL diferente, adicionar uma coluna computada) pode silenciosamente quebrar essa suposição sem que o CI acuse — a suíte de integração que toca Postgres de verdade não cobre este caminho específico.
- **Impacto de negócio**: risco de reincidência silenciosa do mesmo tipo de bug que a ADR-0051 corrigiu (baseline conhecido: R$ 503.066,69 em 2 linhas), sem alarme automatizado até a próxima auditoria manual do report.
- **Métrica de baseline**: 0 de 24 testes de integração da suíte tocada pelo delta exercitam este caminho (repositório + trigger 0057 + `encerrado_em` juntos). **P2** — mitigado nesta sessão por verificação manual, mas não codificado; sem contagem de incidentes em produção que justifique P1.

### F-fault-tolerance-3: o backfill de `encerrado_em` por `atualizado_em` carrega, por desenho, o mesmo viés que motivou a correção — para o subconjunto de linhas terminais re-clicadas antes da 0064

- **Severidade**: P2
- **Tactic violada**: Repair State / Reconcile
- **Localização**: `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql:26-33`
- **Evidência (objetiva)**:
  ```
  Linhas terminais já gravadas recebem `encerrado_em = atualizado_em`. É uma APROXIMAÇÃO, a única
  disponível: para uma linha `settled` re-clicada depois de liquidar, `atualizado_em` é o clique, não
  a liquidação. Foi exatamente essa aproximação que mediu as 2 linhas / R$ 503 mil em 18/09.
  ```
  (ADR-0051 D3 confirma: "Limite conhecido... é a única fonte disponível e é exatamente a que produziu a medição de 18/09.")
- **Impacto técnico**: qualquer linha terminal pré-existente que tenha sido re-clicada (um `beginExecution`/`setBorCod` posterior ao settle avançou `atualizado_em` sem mudar o resultado) antes da 0064 rodar herda, no backfill, o mesmo tipo de erro de data que a migration existe para eliminar dali em diante — o fix é completo apenas para escritas *futuras*.
- **Impacto de negócio**: números históricos recalculados por este delta (semanas anteriores a 28/09) podem ainda estar sutilmente incorretos para linhas específicas; o próprio ADR já avisa a Columbia disso no report do ciclo, mas o tamanho do viés residual pós-fix não foi quantificado.
- **Métrica de baseline**: baseline pré-fix conhecido — 2 linhas / R$ 503.066,69 em 190 (medido 18/09). Quantas dessas (ou outras) ainda carregam o viés residual do backfill não é medível nesta sessão (leitura de produção negada; consulta pronta em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`). **P2** — risco já documentado e aceito pelo time (ADR-0051 D3), mas não fechado com número.

## 5. Cards Kanban

### [fault-tolerance-1] Limpar `encerrado_em` ao reabrir uma execução que falhou

- **Problema**
  > `beginExecution` reabre uma linha `error` para retry sem limpar `encerrado_em`, deixando uma execução genuinamente "em voo" (`reconciling`/`pending`) com um carimbo de encerramento stale de uma falha anterior — contrariando a própria invariante da ADR-0051. Reproduzido em Postgres local (ver F-fault-tolerance-1).

- **Melhoria Proposta**
  > Adicionar `encerrado_em = CASE WHEN <coluna>.status IN ('settled','parcial'[,'settled' para SN]) THEN <coluna>.encerrado_em ELSE NULL END` ao `SET` do `ON CONFLICT DO UPDATE` de `beginExecution`, nos dois repositórios (`PermutaExecucaoRepository.ts:376-389`, `SolicitacaoNumerarioExecucaoRepository.ts:97-118`). Tactic alvo: Repair State. Cobrir com teste de integração que reabre uma linha `error` e verifica `encerrado_em IS NULL` logo após o reopen.

- **Resultado Esperado**
  > Nenhuma linha `reconciling`/`pending` carrega `encerrado_em` não-nulo. Métrica: reprodução do cenário F-1 → de "reaberto com timestamp stale" para "reaberto com `encerrado_em IS NULL`".

- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Teste de integração cobrindo reopen-após-erro: 0 → 1
  - Linhas `reconciling`/`pending` com `encerrado_em` não-nulo em produção: desconhecido → 0 (a confirmar com a query de validação)
- **Risco de não fazer**: em 6 meses, se o volume de retries crescer, o report pode voltar a exibir tentativas "fechadas" em semanas erradas durante janelas de retentativa — o mesmo sintoma que motivou este ciclo inteiro de correção.
- **Dependências**: nenhuma.

### [fault-tolerance-2] Testar `markSettled`/`markParcial`/`markError` contra Postgres real com o trigger 0057 ativo

- **Problema**
  > A suíte de integração que roda contra Postgres real aplica a migration do trigger 0057, mas nunca chama os métodos do repositório — só insere linhas via SQL cru. A prova de que o `CASE WHEN status …` lê o valor antigo da linha e não colide com o trigger existe apenas como verificação manual desta revisão (ver F-fault-tolerance-2).

- **Melhoria Proposta**
  > Adicionar ao `vwMetricasCiclo.integration.test.ts` (ou a um teste de integração dedicado ao repositório) casos que chamem `repo.beginExecution` → `repo.markSettled`/`markParcial`/`markError` de verdade contra o banco com a 0057 aplicada, cobrindo: (a) `markSettled` duas vezes na mesma chave preserva o `encerrado_em` do primeiro settle; (b) reabertura após erro seguida de `markError` de novo atualiza `encerrado_em`; (c) tentativa de reabrir uma linha com `bxa_cod_seq` confirmado continua sendo rejeitada pelo trigger. Tactic alvo: Self-Test.

- **Resultado Esperado**
  > A suíte de integração cobre o caminho repositório+trigger+`encerrado_em` de ponta a ponta, sem depender de verificação manual. Métrica: testes de integração cobrindo este caminho, 0 → ≥3.

- **Tactic alvo**: Self-Test
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Testes de integração repositório+trigger+`encerrado_em`: 0 → ≥3
- **Risco de não fazer**: uma refatoração futura do SQL de `markSettled`/`markError` (ex.: migração para outro query builder) pode reintroduzir o bug da ADR-0051 sem que o CI detecte.
- **Dependências**: nenhuma; pode ser feito junto do card fault-tolerance-1.

### [fault-tolerance-3] Rodar a consulta de validação do backfill contra produção e quantificar o viés residual

- **Problema**
  > O backfill da 0064 (`encerrado_em = atualizado_em`) é uma aproximação declarada, com o mesmo viés conhecido do bug original para linhas terminais re-clicadas antes da migration. O tamanho desse viés residual pós-fix não foi medido (leitura de produção negada nesta sessão).

- **Melhoria Proposta**
  > Executar a consulta já preparada em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md` contra produção, comparando `encerrado_em` pós-backfill com o instante real de liquidação reconstruído a partir de `erp_response`/histórico de auditoria disponível, e anexar o resultado ao report do ciclo em que este delta entra (como a própria ADR-0051 já prevê). Tactic alvo: Reconcile.

- **Resultado Esperado**
  > Número concreto de linhas (e R$) ainda afetadas pelo viés residual do backfill, documentado no report — ou confirmação de que são 0. Métrica: viés residual, "não medido" → valor numérico.

- **Tactic alvo**: Reconcile
- **Severidade**: P2
- **Esforço estimado**: S (≤1d, depende só de acesso de leitura a produção)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Viés residual quantificado: desconhecido → valor numérico (linhas e R$)
- **Risco de não fazer**: a Columbia pode continuar recebendo, para um subconjunto pequeno e não identificado de baixas antigas, o mesmo tipo de número errado que este ciclo inteiro existiu para corrigir — sem saber que ainda existe.
- **Dependências**: acesso de leitura ao Postgres de produção (negado ao agente nesta sessão).

## 6. Notas do agente

- Escopo: revisão restrita ao delta (`git diff origin/main..HEAD`), conforme instrução. Débito pré-existente (ex.: SN não ter um trigger equivalente ao 0057; `beginExecution` em si) citado só como contexto de interação, não como finding — é código não tocado pelo delta.
- Validei empiricamente (docker `postgres:17-alpine` local, fora da suíte) a pergunta central da tarefa: o `CASE WHEN status IN (...)` no `SET` de `markSettled`/`markParcial`/`markError` lê o valor **antigo** da linha, e o trigger 0057 não bloqueia nenhum caminho legítimo destas escritas — nenhum P0/P1 encontrado na interação. O gap é a AUSÊNCIA dessa prova como teste automatizado (F-2), não um bug ativo.
- Leitura de produção foi negada ao agente nesta sessão (mesma limitação registrada no `_shared-metrics.md`) — F-1 e F-3 ficam sem baseline numérico de produção e por isso em P2, não P1, por regra do template.
- Cross-QA: F-fault-tolerance-2 (cobertura de teste de integração) é o mesmo tipo de gap que Testability provavelmente também sinaliza — cross-referenciar. F-fault-tolerance-1/3 (correção retroativa de métrica publicada) toca Security/auditabilidade apenas indiretamente: não há tabela de audit-trail separada neste repo — a atribuição fica nas colunas do próprio ledger (`executado_por`/`conexos_username`/`erp_response`), padrão pré-existente e fora do escopo deste delta.
