---
qa: Availability
qa_slug: availability
run_id: 2026-09-28-1534
agent: qa-availability
generated_at: 2026-09-28T18:34:00-03:00
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Deploy do backend (Render, via `BootMigrator`) carregando esta feature (ADR-0051) | Migração `0064` roda `ALTER TABLE` + backfill (`UPDATE ... WHERE encerrado_em IS NULL`) sobre `permuta_alocacao_execucao`/`solicitacao_numerario_execucao` — os mesmos ledgers que jobs de Permutas/Recebimentos podem estar escrevendo concorrentemente (`markSettled`/`markError`, mesmo `idempotency_key`) | Ledgers de execução das Frentes I e IV + processo de boot do Express | Produção, horário comercial, jobs diários possivelmente em voo | Migração aplica-se atomicamente (1 transação por arquivo + advisory lock, `runMigrations.ts:130-152`); se falhar, `BootMigrator` aborta o boot inteiro em vez de servir tráfego contra esquema incerto (`BootMigrator.ts:42-49`); se passar, o backfill não pisa em linha já carimbada (idempotente) e a função `metricas.metricas_ciclo` é substituída sem quebrar o contrato de colunas que o report já consome | 0 linhas de ledger corrompidas pelo backfill; reaplicar a `0064` é no-op (testado); boot só serve tráfego com o esquema em dia |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Migração 0064 idempotente (ADD COLUMN / backfill / função) | `IF NOT EXISTS`, backfill só `WHERE encerrado_em IS NULL`, `CREATE OR REPLACE FUNCTION` | Reaplicar sem efeito colateral | ✅ | `0064_metricas_ciclo_data_pelo_encerramento.sql:48-67,71`; testado em `vwMetricasCiclo.integration.test.ts` ("reaplicar a migration é no-op") |
| Linhas afetadas pelo backfill | ~190 (permuta + SN) | < 1.000 (limiar que exige script de reverse) | ✅ | `_shared-metrics.md` (Repo baselines); `migrations/rollbacks/README.md` |
| Migração roda em transação isolada + advisory lock | 1 transação por arquivo (`applyOne`), `pg_advisory_xact_lock` transacional | Atômico, sem estado parcial em caso de falha | ✅ | `runMigrations.ts:130-152` |
| Contrato da função de métricas preservado após `CREATE OR REPLACE` | 11 colunas idênticas (9 do contrato + `parcial` + `apurado_ate`) | Nenhuma quebra de "cached plan" para consumidores já rodando | ✅ | teste "a 0064 não altera o contrato" em `vwMetricasCiclo.integration.test.ts` |
| Cobertura de teste dos cenários de retentativa/idempotência introduzidos | 5 casos de integração novos (retentativa permuta, retentativa SN, re-clique, backfill, contrato) + 5 guardas estáticas novas | Cenários de retry cobertos antes de produção | ✅ | `_shared-metrics.md` (Gates); `vwMetricasCiclo.integration.test.ts`, `vwMetricasCiclo.test.ts` |
| Invariante "`encerrado_em` imóvel após 1º encerramento terminal" garantida em nível de banco (CHECK/TRIGGER) | 0 ocorrências de `CHECK`/`TRIGGER` sobre `encerrado_em` | ≥1 barreira em nível de esquema para uma coluna que alimenta número publicado à diretoria | ⚠️ | `grep -n "TRIGGER\|CHECK (" src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql` → 0; `grep -rn encerrado_em src/backend` → só as 2 repositories + a função |
| Visibilidade de falha crônica (retentativa que nunca liquida) na métrica semanal | `markError` sempre grava `encerrado_em = now()`, sem teto de idade | Falha aberta há N semanas deveria ser rastreável, não "reaparecer" só na semana do último retry | ⚠️ | `PermutaExecucaoRepository.ts:536-544`, `SolicitacaoNumerarioExecucaoRepository.ts:349-356` |

> ⚠️ **Não medível localmente**: impacto real de lock/contenção do backfill da `0064` contra tráfego de produção concorrente (duração de lock, deadlocks). Requer CloudWatch/logs de produção do momento do deploy. Recomendação: instrumentar o job de deploy com o tempo de execução de cada migração (`BootMigrator` já loga início/fim — agregar em dashboard).
> ⚠️ **Não medível localmente**: MTTR real de um boot que falha por migração quebrada. Requer métrica de produção (tempo entre falha de boot e novo deploy verde). Recomendação: dashboard com duração de `[boot-migrate]` e alarme em falha de boot.

## 3. Tactics — Cobertura no nf-projects (avaliação restrita ao delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não tocado pelo delta | N/A | — |
| Heartbeat | Não tocado pelo delta | N/A | — |
| Monitor | Sem CloudWatch/dashboard no repo (`infra/` não existe) | N/A | `_shared-metrics.md`: "Não medível: no `infra/`" |
| Timestamp | `encerrado_em` é a tactic Timestamp aplicada ao domínio: separa "quando nasceu" (`criado_em`), "quando alguém tocou" (`atualizado_em`) e "quando terminou de fato" (`encerrado_em`), exatamente para atribuir corretamente o resultado de uma retentativa à janela em que ela concluiu | ✅ presente | `0064_metricas_ciclo_data_pelo_encerramento.sql:13-24` |
| Sanity Checking | Invariante "encerrado_em não anda para trás de um encerramento terminal" garantida só por `COALESCE` em SQL de aplicação, em 2 repositórios; nenhuma barreira de esquema (CHECK/TRIGGER) | ⚠️ parcial | F-availability-1 |
| Condition Monitoring | Métrica semanal expõe `tentativas`/`concluidas`, mas uma execução que falha repetidamente perde a semana original a cada retry (F-availability-2) | ⚠️ parcial | F-availability-2 |
| Voting | Fonte única (Postgres); não há computação redundante a arbitrar | N/A | — |
| Exception Detection | `markError` persiste `erro_mensagem`/`erp_response` (pré-existente); delta só acrescenta o carimbo de tempo à mesma escrita atômica | ✅ presente | `PermutaExecucaoRepository.ts:536-544` |
| Self-Test | Não tocado pelo delta | N/A | — |
| Active Redundancy | Não tocado pelo delta | N/A | — |
| Passive Redundancy | Não tocado pelo delta | N/A | — |
| Spare | Não tocado pelo delta | N/A | — |
| Exception Handling | `markError` continua sendo 1 UPDATE parametrizado só; `encerrado_em` some na mesma escrita, sem passo extra que possa falhar parcialmente | ✅ presente | `SolicitacaoNumerarioExecucaoRepository.ts:349-356` |
| Rollback | Migração roda em transação isolada por arquivo + advisory lock; idempotente (`IF NOT EXISTS`, backfill só onde NULL, `CREATE OR REPLACE`); abaixo do limiar de 1.000 linhas que exigiria script de reverse; reversão manual documentada no cabeçalho da própria migração | ✅ presente | `runMigrations.ts:130-152`; `0064_metricas_ciclo_data_pelo_encerramento.sql:29-33`; `migrations/rollbacks/README.md` |
| Software Upgrade | `CREATE OR REPLACE FUNCTION` preserva o contrato de saída (mesmas 9 colunas + `parcial`+`apurado_ate`), evitando o erro do Postgres "cached plan must not change result type" para quem já chama a função | ✅ presente | teste "a 0064 não altera o contrato", `vwMetricasCiclo.integration.test.ts` |
| Retry | Todo o recorte da feature existe para datar corretamente uma execução reexecutada (upsert por `idempotency_key`); testes cobrem retentativa de permuta e de SN explicitamente | ✅ presente | `PermutaExecucaoRepository.test.ts` ("markSettled/markParcial carimbam... só no 1º encerramento"), `vwMetricasCiclo.integration.test.ts` ("retentativa conta na semana em que liquidou") |
| Ignore Faulty Behavior | Não tocado pelo delta | N/A | — |
| Degradation | Delta não toca fila de exceção/itens bloqueados | N/A | — |
| Reconfiguration | Não tocado pelo delta | N/A | — |
| Shadow | Não tocado pelo delta | N/A | — |
| State Resynchronization | Backfill da `0064` resincroniza `encerrado_em` para ~190 linhas terminais pré-existentes, alinhando histórico ao novo invariante | ✅ presente | `0064_metricas_ciclo_data_pelo_encerramento.sql:59-67`; teste "backfill da 0064" em `vwMetricasCiclo.integration.test.ts` |
| Escalating Restart | `BootMigrator` (pré-existente, não alterado pelo delta) espera o lock com backoff fixo e falha após 30 tentativas — não escalona estratégia, mas não é alterado por este delta | N/A (fora do delta) | `BootMigrator.ts:119-150` |
| Non-Stop Forwarding | Não tocado pelo delta | N/A | — |
| Removal from Service | Não tocado pelo delta | N/A | — |
| Transactions | Migração é 1 transação ACID (DDL + backfill + `CREATE OR REPLACE` + registro em `schema_migrations`) sob `pg_advisory_xact_lock`; cada transição de estado nos repositórios continua sendo 1 único UPDATE parametrizado | ✅ presente | `runMigrations.ts:141-152`; `PermutaExecucaoRepository.ts:454-458` |
| Predictive Model | Não tocado pelo delta | N/A | — |
| Exception Prevention | `CASE WHEN status IN (...)` previne que um re-clique sobre linha já terminal mova `encerrado_em` para frente; mas nada impede (nem testa) um terceiro escritor fora destes 2 repositórios de violar o invariante | ⚠️ parcial | F-availability-1 |
| Increase Competence Set | Não tocado pelo delta | N/A | — |

## 4. Findings (achados)

### F-availability-1: Invariante de imutabilidade de `encerrado_em` só existe em SQL de aplicação, não no esquema

- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Exception Prevention
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:454-458,509-513`; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:323-327`; `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql`
- **Evidência (objetiva)**:
  ```
  $ grep -c "TRIGGER\|CHECK (" src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql
  0
  ```
  O invariante "uma vez `settled`/`parcial`, `encerrado_em` não anda mais" é garantido só pelo padrão `CASE WHEN status IN (...) THEN COALESCE(encerrado_em, now()) ELSE now() END`, repetido em 2 repositórios. Não há `CHECK` nem `TRIGGER` no esquema.
- **Impacto técnico**: qualquer escrita futura a estas tabelas que não passe por `markSettled`/`markParcial` (um script de correção manual, uma migração de dados, um terceiro repositório) pode sobrescrever `encerrado_em` de uma linha já liquidada sem que nada no banco reclame.
- **Impacto de negócio**: o número que vai para a diretoria (`permutas_valor_baixado`, `recebimentos_valor_alocado`) migraria de semana silenciosamente — o mesmo defeito que a ADR-0051 corrige, reintroduzido por um caminho de escrita que os testes atuais não cobrem porque não existe ainda.
- **Métrica de baseline**: N/A (P2, dispensa baseline numérico pela regra de severidade).

### F-availability-2: Falha crônica em retentativa perde a semana original a cada novo erro

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:536-544`; `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts:349-356`
- **Evidência (objetiva)**:
  ```sql
  -- markError, nas duas tabelas:
  encerrado_em = now(),
  atualizado_em = now()
  ```
  Diferente de `markSettled`/`markParcial` (que travam `encerrado_em` no 1º encerramento via `COALESCE`), `markError` reescreve `encerrado_em` a CADA falha. Uma execução que falhou em 10/08, foi reexecutada e falhou de novo em 20/09 (ainda sem liquidar) conta como "tentativa" só na semana de 20/09 — a semana de 10/08, onde o problema de fato começou, fica muda sobre ela.
- **Impacto técnico**: a série semanal não distingue "problema novo desta semana" de "problema antigo que só falhou de novo agora"; um item preso há meses em retry aparece e desaparece de semana em semana conforme o agendador tenta de novo.
- **Impacto de negócio**: o indicador `permutas_baixas_concluidas_pct`/`recebimentos_alocacoes_concluidas_pct` pode mascarar quanto tempo uma falha está de fato aberta — o próprio problema que a Frente de métricas (ADR-0051) foi criada para não ter, agora do lado do `error` em vez do `settled`.
- **Métrica de baseline**: N/A (P2, comportamento é por design conforme o comentário do código — "um retry que liquide sobrescreve no markSettled" — mas o caso "nunca liquida" não tem tratamento nem teste).

### F-availability-3: Migração de métrica compartilha o boot fail-fast com migrações de escrita crítica

- **Severidade**: P3
- **Tactic violada**: Removal from Service (isolamento de blast radius entre mudança de baixo risco e caminho crítico)
- **Localização**: `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql` executado por `src/backend/migrations/BootMigrator.ts:42-49` (pré-existente, não alterado pelo delta)
- **Evidência (objetiva)**:
  ```
  // BootMigrator.ts:42-43
  // Migração que falha derruba o boot. Servir contra um esquema desconhecido é pior que não servir
  ```
  A `0064` faz `ALTER TABLE` + `UPDATE` de backfill sobre as mesmas tabelas que os jobs de Permutas/SN escrevem em produção. Se essa migração falhar por qualquer motivo (ex.: contenção de lock com uma execução concorrente), o `BootMigrator` aborta o boot inteiro — não só a feature de métricas, mas Permutas, SISPAG e Recebimentos ficam fora do ar até o próximo deploy.
- **Impacto técnico**: acoplamento de risco entre uma mudança de baixo valor de negócio (relatório de ciclo) e a disponibilidade do sistema de execução financeira inteiro.
- **Impacto de negócio**: baixa probabilidade (backfill de ~190 linhas, testado, transacional) mas alto custo se ocorrer: indisponibilidade total do backend, não isolada à Frente que mudou.
- **Métrica de baseline**: N/A (P3, dispensa baseline).

## 5. Cards Kanban

### [availability-1] Adicionar barreira de esquema para a imutabilidade de `encerrado_em`

- **Problema**
  > O invariante "`encerrado_em` não anda para trás de um encerramento terminal (`settled`/`parcial`)" existe só como convenção repetida em 2 repositórios (`PermutaExecucaoRepository`, `SolicitacaoNumerarioExecucaoRepository`). Nenhuma barreira de esquema impede uma terceira escrita de violá-lo.

- **Melhoria Proposta**
  > Tactic Bass alvo: Sanity Checking. Adicionar um `TRIGGER BEFORE UPDATE` (ou `CHECK` combinado com uma função) em `permuta_alocacao_execucao` e `solicitacao_numerario_execucao` que rejeite (ou registre) qualquer tentativa de mover `encerrado_em` para uma linha cujo `status` OLD já era `settled`/`parcial` e cujo `encerrado_em` OLD não era NULL. Escopo: nova migração (`0065`), sem tocar os repositórios existentes.

- **Resultado Esperado**
  > Invariante passa a ser garantido pelo banco, não só pela disciplina de 2 arquivos TypeScript. Métrica: 0 → 1 barreira de esquema (`CHECK`/`TRIGGER`) protegendo `encerrado_em`.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Barreiras de esquema sobre `encerrado_em`: 0 → ≥1
- **Risco de não fazer**: um script de correção manual futuro (ou uma nova frente reaproveitando o padrão sem repetir o `CASE WHEN`) reintroduz silenciosamente o mesmo defeito que a ADR-0051 corrigiu, e ninguém percebe até o número publicado errar de novo.
- **Dependências**: nenhuma.

### [availability-2] Distinguir "falha nova" de "falha antiga que retentou" na métrica de ciclo

- **Problema**
  > `markError` carimba `encerrado_em = now()` a cada falha, sem limite. Uma execução presa em retry por semanas aparece só na semana do último erro, nunca nas semanas anteriores em que já estava falhando — a série perde a idade real do problema.

- **Melhoria Proposta**
  > Tactic Bass alvo: Condition Monitoring. Preservar também o instante da PRIMEIRA falha (ex.: nova coluna `primeiro_erro_em`, carimbada só quando NULL) e expor no relatório de ciclo (ou num painel operacional separado) quantas execuções em `error` têm `primeiro_erro_em` mais antigo que N semanas — sinal de item cronicamente preso, hoje invisível na métrica agregada.

- **Resultado Esperado**
  > Operação consegue distinguir "1 falha nova esta semana" de "1 falha de 6 semanas atrás que só tentou de novo". Métrica: 0 → 1 indicador de idade de falha crônica na série de métricas.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — nova coluna + backfill + ajuste da função + testes
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Indicador de idade de falha crônica na métrica de ciclo: ausente → presente
- **Risco de não fazer**: um título/baixa preso há meses continua parecendo "problema desta semana" toda vez que o agendador tenta de novo, escondendo do analista quanto tempo o item já está fora do fluxo automático.
- **Dependências**: nenhuma; pode vir depois do `availability-1` (mesma família de colunas de auditoria).

### [availability-3] Isolar migrações de baixo risco do boot fail-fast do caminho crítico

- **Problema**
  > O `BootMigrator` aborta o boot inteiro do backend se QUALQUER migração pendente falhar — incluindo a `0064`, que só ajusta uma coluna de relatório, mas roda `ALTER`/`UPDATE` sobre as mesmas tabelas de ledger que Permutas e Recebimentos escrevem em produção. Uma falha nessa migração de baixo valor de negócio derrubaria a disponibilidade de todo o sistema de execução financeira, não só do relatório.

- **Melhoria Proposta**
  > Tactic Bass alvo: Removal from Service (isolamento de blast radius). Não é urgente reescrever o `BootMigrator` agora — mas registrar a política explicitamente: migrações que só alimentam relatório/observabilidade (sem mudar contrato de escrita das Frentes) deveriam, quando praticável, ser aditivas e testadas para tolerar skip/retry sem exigir boot fail-fast, ou aplicadas fora do caminho de boot (job manual supervisionado, como já existe para os rollbacks).

- **Resultado Esperado**
  > Próxima migração "só de métrica" nasce com essa pergunta feita explicitamente na revisão: "esta migração PRECISA compartilhar o fail-fast do caminho crítico?". Métrica: decisão registrada em ADR/checklist do pipeline de migração, não um número.

- **Tactic alvo**: Removal from Service
- **Severidade**: P3
- **Esforço estimado**: L (1-2sem) — decisão de arquitetura + eventual split do `BootMigrator`, não uma correção pontual
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - N/A — item é de política/arquitetura, não de métrica pontual observável nesta review.
- **Risco de não fazer**: aceitável no curto prazo (baixa probabilidade, migração testada e transacional); risco cresce se migrações futuras de baixo risco continuarem sendo agrupadas ao mesmo fail-fast sem essa pergunta ser feita.
- **Dependências**: nenhuma; é o card de menor urgência dos três.

## 6. Notas do agente

- Escopo restrito ao delta (`git diff origin/main..HEAD`): a tabela de tactics marca N/A tudo que a feature não toca, em vez de reauditar o sistema inteiro (já coberto em ciclos anteriores).
- F-availability-3 é sobre um componente pré-existente (`BootMigrator`) não alterado pelo delta; citado porque a `0064` é quem ativa esse caminho contra tabelas de ledger — não é uma regressão introduzida por este PR, é um trade-off de arquitetura exposto por ele.
- Nenhum finding chegou a P0/P1: a migração é transacional, idempotente, testada (24/24 integração + 21/21 estático) e abaixo do limiar de linhas que exigiria script de reverse. Cross-QA: F-availability-1 e F-availability-2 têm sobreposição com Testability (ausência de teste para "terceiro escritor" e para "falha crônica") — vale o `qa-testability` conferir se já cobriu por outro ângulo.
