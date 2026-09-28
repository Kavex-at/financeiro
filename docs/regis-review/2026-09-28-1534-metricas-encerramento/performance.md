---
qa: Performance
qa_slug: performance
run_id: 2026-09-28-1534-metricas-encerramento
agent: qa-performance
generated_at: 2026-09-28T15:55:00-03:00
scope: backend
score: 7
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (dashboard `GET /metricas/ciclo`) ou job agendado que consome a mesma função | Requisição lê `metricas.metricas_ciclo()`, que agora escolhe a data pelo `COALESCE(encerrado_em, criado_em)` (ADR-0051) em vez de só `criado_em` (0058) | `permuta_alocacao_execucao` e `solicitacao_numerario_execucao` (ledgers), função SQL `metricas.metricas_ciclo()` | Produção, pool `pg` compartilhado (`poolMaxConnections=5`), ledgers crescendo ~190 linhas hoje, uma janela nova por semana desde o piso fixo `2026-08-07` (ADR-0048) | A função deve responder dentro de um orçamento aceitável para uma tela interativa e não competir por conexões do pool sob concorrência | Latência da função sem degradar acima de ~O(janelas) conforme o ledger cresce; escrita da baixa (`markSettled`/`markError`) sem round-trip extra ao Postgres |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `metricas_ciclo()` @ 5.000 linhas sintéticas, W=6 janelas (novo predicado `COALESCE`) | 12,8 ms (`Function Scan`, `actual time=12.713..12.714`) | < 50 ms (tela interativa) | ✅ | `EXPLAIN (ANALYZE, BUFFERS)` rodado nesta sessão contra `metricas-ciclo-pg-test-0064` (Postgres 17, migrations até 0064 aplicadas), transação com `ROLLBACK` |
| `metricas_ciclo()` @ 5.000 linhas sintéticas, W=111 janelas (~2 anos de piso) | 193,0 ms (`actual time=192.933..192.946`) | < 300 ms; crescimento sub-quadrático | ⚠️ | idem |
| Razão de custo W111/W6 vs. razão de janelas (111/6=18,5×) | 15,1× (193,0/12,8) | Idealmente ≤ 1× (custo independente do nº de janelas) | ⚠️ | idem — confirma que o formato `O(janelas × linhas)` do `performance-1` pré-existente **não muda** com este delta (mesmo `Nested Loop`/`Materialize` por janela; só a expressão de data trocou) |
| Índice cobrindo o novo predicado de junção `COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo'` | 0 (nenhum índice em `encerrado_em`, nenhum em `criado_em`) | 1 índice de expressão, quando o ledger justificar | ⚠️ | `\d public.permuta_alocacao_execucao` no mesmo container — apenas `pkey`, `idempotency_key` unique, `status`, `bor_cod` e `adiantamento_doc_cod` indexados |
| Round-trips adicionais ao Postgres por `markSettled`/`markError` | 0 (coluna nova entra no mesmo `UPDATE ... WHERE idempotency_key = $key`) | 0 | ✅ | `PermutaExecucaoRepository.ts:449-460,504-515,536-541`; `SolicitacaoNumerarioExecucaoRepository.ts:318-329,349-354` (diff do delta) |
| Linhas tocadas pelo backfill da 0064 | ~190 (abaixo do limiar de 1.000 do `rollbacks/README.md`) | — | ✅ | `_shared-metrics.md` |
| Lock/duração do `ALTER TABLE ADD COLUMN` | Metadata-only (sem `DEFAULT`, Postgres ≥ 11 não reescreve a tabela) | O(1) independente do tamanho da tabela | ✅ | `0064_metricas_ciclo_data_pelo_encerramento.sql:38-42` — `ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ` sem `DEFAULT` |

> ⚠️ **Não medível nesta sessão**: comportamento em produção com o volume real (~190-200 linhas) e
> concorrência real do pool. O container `metricas-ciclo-pg-test-0064` só tinha os 14 registros de
> fixture da suíte de integração; os números acima vieram de 5.000 linhas sintéticas inseridas e
> revertidas (`BEGIN … ROLLBACK`) na mesma sessão, para reproduzir a metodologia do
> `metricas-historico-6-semanas-regis-followups.md` (que também usou 5.000 linhas) e permitir
> comparação direta.

## 3. Tactics — Cobertura no nf-projects (recorte do delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — delta não é pipeline de ingestão/amostragem | N/A | — |
| Limit Event Response | N/A — nenhum gatilho (API/SQS/EventBridge) alterado neste delta | N/A | — |
| Prioritize Events | N/A — sem fila nem concorrência de eventos no escopo | N/A | — |
| Reduce Overhead | A coluna nova entra no `UPDATE` já existente de `markSettled`/`markError`; zero round-trip adicional ao Postgres | ✅ presente | `PermutaExecucaoRepository.ts:449-460`; `SolicitacaoNumerarioExecucaoRepository.ts:318-329` |
| Bound Execution Times | `ADD COLUMN` sem `DEFAULT` (metadata-only); backfill restrito a ~190 linhas, dentro do limiar de 1.000 que dispensa script de reverse | ✅ presente | `0064...sql:38-42,45-52`; `_shared-metrics.md` |
| Increase Resource Efficiency | O predicado de junção trocou de `criado_em` para `COALESCE(encerrado_em, criado_em)`, mas nenhum índice foi adicionado — a função segue fazendo `Nested Loop`/`Materialize` por janela sobre o ledger inteiro | ⚠️ parcial (não piora, não resolve) | `0064...sql:97-99,116-119`; EXPLAIN acima |
| Increase Concurrency | N/A — sem mudança de handler/Lambda neste delta | N/A | — |
| Increase Resources | N/A | N/A | — |
| Maintain Multiple Copies of Computations | A função continua sendo calculada ao vivo a cada chamada, sem materialização/cache — mesma dívida do `performance-1` pré-existente, não introduzida nem resolvida aqui | ⚠️ ausente (herdado) | `0064...sql` (função `STABLE`, não materializada) |
| Maintain Multiple Copies of Data | N/A — fora do escopo do delta | N/A | — |
| Bound Queue Sizes | N/A — sem SQS no delta | N/A | — |
| Schedule Resources | N/A — sem Lambda/EventBridge no delta | N/A | — |

## 4. Findings (achados)

### F-performance-1: `0064` preserva o formato `O(janelas × linhas)` de `metricas_ciclo()` — não piora, não resolve o `performance-1` já registrado

- **Severidade**: P2 (informativo — sem card próprio; já rastreado como P1 em outro follow-up)
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql:78-120` (CTEs `permutas`/`recebimentos`)
- **Evidência (objetiva)**:
  ```
  W=6,   5.000 linhas: Function Scan … actual time=12.713..12.714  → 12,8 ms
  W=111, 5.000 linhas: Function Scan … actual time=192.933..192.946 → 193,0 ms
  (medido nesta sessão contra o Postgres 17 com a 0064 aplicada; mesma metodologia do
  baseline registrado em ontology/_inbox/metricas-historico-6-semanas-regis-followups.md,
  que mediu 19,6 ms @ W=6 e 333,9 ms @ W=111 na função da 0058/0060, pré-0064)
  ```
- **Impacto técnico**: a única mudança estrutural do delta na junção é trocar `criado_em` por
  `COALESCE(encerrado_em, criado_em)` — o plano continua sendo `Nested Loop Left Join` recalculando o
  filtro por janela sobre o ledger inteiro, sem nenhum índice novo cobrindo o predicado. O crescimento
  permanece atrelado a janelas × linhas, não a janelas + linhas.
- **Impacto de negócio**: nenhum efeito imediato (ledger com ~190-200 linhas hoje); a curva de custo
  já projetada no follow-up anterior (centenas de ms em ~1 ano, possivelmente >1 s em ~2 anos) segue
  válida sem alteração.
- **Métrica de baseline**: razão de custo 15,1× (W111/W6) neste delta vs. 17,0× medido antes da 0064 —
  mesma ordem de grandeza; a variação está dentro do ruído de ambiente (containers diferentes), não é
  uma melhoria algorítmica.

> Não vira card nesta seção: já existe `performance-1` aberto em
> `ontology/_inbox/metricas-historico-6-semanas-regis-followups.md` com o mesmo diagnóstico. Duplicar o
> card criaria dois tickets para a mesma causa-raiz.

### F-performance-2: o novo predicado de junção (`COALESCE` de duas colunas nuláveis) torna o índice de correção do `performance-1` mais caro de desenhar, e nenhum índice foi criado para ele

- **Severidade**: P2
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql:38-42` (colunas novas) e `:97,116` (predicado `COALESCE(...) AT TIME ZONE 'America/Sao_Paulo'`)
- **Evidência (objetiva)**:
  ```sql
  ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;   -- sem índice
  ...
  COALESCE(x.encerrado_em, x.criado_em) AT TIME ZONE 'America/Sao_Paulo' AS data_local
  ```
  `\d public.permuta_alocacao_execucao`: nenhum índice em `encerrado_em` nem em `criado_em`.
- **Impacto técnico**: o follow-up `performance-1` já apontava que nem um índice simples em
  `criado_em` resolveria (por causa do `AT TIME ZONE`); agora a expressão depende de **duas** colunas
  nuláveis via `COALESCE`, então o índice de expressão que eventualmente resolver o `performance-1`
  precisa cobrir `COALESCE(encerrado_em, criado_em)`, não só uma coluna — mais uma decisão de design
  que quem for consertar o `performance-1` precisa conhecer.
- **Impacto de negócio**: nenhum hoje (ledger pequeno); aumenta o custo de implementação futura do
  card que já está na fila.
- **Métrica de baseline**: 0 índices cobrindo o predicado, em ambas as colunas envolvidas
  (`encerrado_em` e `criado_em`), medido via `\d` no Postgres de teste desta sessão.

## 5. Cards Kanban

### [performance-1] Registrar a expressão `COALESCE(encerrado_em, criado_em)` como a assinatura definitiva a indexar quando `performance-1` for tratado

- **Problema**
  > O `performance-1` pré-existente (custo `O(janelas × linhas)` de `metricas_ciclo()`) segue aberto e
  > **inalterado** por este delta — nem piora nem melhora, medido em 12,8 ms → 193,0 ms (W=6 → W=111,
  > 5.000 linhas sintéticas). Mas o delta muda o predicado de junção de `criado_em` para
  > `COALESCE(encerrado_em, criado_em)`, e nenhum índice cobre nenhuma das duas colunas. Sem
  > registrar isso agora, o próximo agente que pegar o `performance-1` vai redescobrir do zero que o
  > índice precisa ser de expressão sobre `COALESCE`, não sobre uma coluna simples.

- **Melhoria Proposta**
  > Tactic: Increase Resource Efficiency. Atualizar o card `performance-1` existente (em
  > `ontology/_inbox/metricas-historico-6-semanas-regis-followups.md`, ou onde ele for consolidado) com
  > a assinatura exata do índice necessário:
  > `CREATE INDEX ... ON permuta_alocacao_execucao ((COALESCE(encerrado_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')) WHERE dry_run = false;`
  > e equivalente em `solicitacao_numerario_execucao`. Não implementar agora (ledger ainda pequeno,
  > sem urgência) — só documentar para não perder o conhecimento gerado por este delta.

- **Resultado Esperado**
  > Quando `performance-1` for endereçado: tempo de implementação do índice reduzido (a decisão de
  > design já está registrada), sem precisar re-derivar a expressão a partir do SQL da 0064. Métrica
  > de sucesso não é de runtime agora, é de continuidade de conhecimento entre revisões.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — é só atualizar a anotação do follow-up existente, não codar índice
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Anotação do índice de expressão presente no follow-up `performance-1`: ausente → presente
  - Tempo de implementação do índice quando o card for priorizado: reduzido (decisão já tomada)
- **Risco de não fazer**: quando o ledger crescer o suficiente para o `performance-1` virar prioridade
  (projeção: ~1-2 anos), quem pegar o card vai precisar reconstruir esta análise (duas colunas
  nuláveis, `AT TIME ZONE`, `COALESCE`) do zero — retrabalho pequeno, mas evitável.
- **Dependências**: card `performance-1` do ciclo `metricas-historico-6-semanas` (não duplicar,
  apenas enriquecer)

## 6. Notas do agente

- Escopo: findings restritos ao delta (migration 0064 + 2 repositórios + testes), por instrução do
  orquestrador. Reusei o container Postgres 17 já provisionado pelo `_shared-metrics.md`
  (`metricas-ciclo-pg-test-0064`) para o `EXPLAIN ANALYZE`, inserindo 5.000 linhas sintéticas dentro de
  uma transação com `ROLLBACK` — nenhum dado da suíte de integração foi alterado.
- **Cross-QA**: o índice de expressão recomendado no card `performance-1` (aqui e no follow-up
  anterior) é dívida de **Modifiability** também — `criado_em`/`encerrado_em` sem índice é schema que
  qualquer novo filtro por data vai reproduzir. Não duplicar, só linkar.
- Conclusão central: **o `performance-1` (P1, `O(janelas × linhas)`) não muda de severidade com este
  delta** — medido, não só argumentado por leitura de código.
