---
qa: Performance
qa_slug: performance
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-performance
generated_at: 2026-09-15T18:35:00-03:00
scope: backend+frontend
score: 8
findings_count: 5
cards_count: 3
---

# Performance — Regis-Review

> Escopo: delta `origin/main..HEAD` da feature `permutas-excecao-manual` (9 commits, 48 arquivos,
> +3990/−52). Só o que a feature move em latência/throughput/custo. `--quick`.
> Stack real (não o alvo do CLAUDE.md): Express em `src/backend/` na Render + Supabase Postgres,
> Next 15 em `src/frontend/`. Sem `infra/`, sem Lambda — cold start N/A.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista admin (columbiatrading) + cron 3×/dia da ingestão de permutas | `POST /permutas/adiantamentos/:docCod/excecao-manual` (marcar), `DELETE …/excecao-manual` (desfazer), `GET /permutas/gestao` (leitura do painel a cada 30s), pós-passe da eleição/ingestão (`EleicaoPermutasService.computeCandidatas`) | `ExcecaoPermutaRepository.listAtivas/findAtiva`, tabela nova `permuta_excecao_manual`, `UPDATE permuta_adiantamento` com trava otimista, migration 0059 (VALIDATE CONSTRAINT sobre 2 tabelas), pós-passe `aplicarExcecoes` em memória | Produção nominal, ~800 adiantamentos ativos, backlog crescente de `permuta_candidata_snapshot` (3 runs/dia, sem retention), pool pg default | +1 query por run/leitura sem N+1, guarda + soft-delete + reclassificação numa transação, migration idempotente com `NOT VALID` + `VALIDATE` que não bloqueia produção | Latência do `/gestao` estável (Δ ≤ 20ms sobre o baseline pré-feature); overhead do pós-passe ≤ 5ms para ≤ 800 candidatas; VALIDATE CONSTRAINT do deploy ≤ 500ms na `permuta_candidata_snapshot` sob crescimento observado; nenhum novo N+1 |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Queries extras em `GET /permutas/gestao` por request | +1 (`ExcecaoPermutaRepository.listAtivas`) | ≤ +2 sem novo N+1 | ✅ | `GestaoPermutasService.ts:102` (dentro do `Promise.all` das 9 leituras) |
| Queries extras por `computeCandidatas` (ingestão + eleição) | +1 (`listAtivas` no pós-passe) | ≤ +1 por run | ✅ | `EleicaoPermutasService.ts:437` |
| Índice cobrindo `listAtivas` | Índice parcial `uq_permuta_excecao_manual_ativa (adiantamento_doc_cod) WHERE removido_em IS NULL` — o `WHERE removido_em IS NULL` bate exatamente com o parcial | Index scan (sem seq-scan) | ✅ | `migrations/0059_excecao_permuta.sql:66-68`, `ExcecaoPermutaRepository.ts:33` |
| Cardinalidade esperada do `listAtivas` | ≤ N de adtos ativos com exceção. Índice parcial limita a **1 exceção ativa por adto**; universo teto ≈ nº de adtos `bloqueada+sem-saldo-permutar`. Caso motivador: 1 (adto 8721). Universo prático estimado: 1–20 | ≤ 100 | ✅ | Interview §caso motivador; guarda I-Exc-1 restringe a origem |
| N+1 introduzido | 0. O pós-passe é `candidatas.map(...)` puro em memória; a lookup é `Set<docCod>` construído 1×; `GestaoPermutasService` monta `Map<docCod,ExcecaoPermuta>` 1× | 0 | ✅ | `ExcecaoPermutaService.ts:81-107`, `GestaoPermutasService.ts:104-106` |
| `selectMany` sem LIMIT introduzidos | 1 (`listAtivas`) — bounded pelo índice parcial (unicidade por adto ativo), não pela cláusula | 0 unbounded sem justificativa | ⚠️ (justificado) | `ExcecaoPermutaRepository.ts:28-37` |
| Roundtrips por `POST …/excecao-manual` (marcar) | 4 síncronos: `findAdiantamento` + `findAtiva` + (tx: `INSERT` + `UPDATE reclassificar`) | ≤ 5 numa rota admin/baixa-frequência | ✅ | `ExcecaoPermutaService.ts:117-164` |
| Roundtrips por `DELETE …/excecao-manual` (desfazer) | 2 na tx: `UPDATE soft-delete` + `UPDATE reclassificar` | ≤ 3 | ✅ | `ExcecaoPermutaService.ts:172-194` |
| Custo do `VALIDATE CONSTRAINT` em `permuta_adiantamento` (~800 rows) | ~1ms — seq-scan de tabela pequena com CHECK simples; nenhuma linha viola por construção (código antigo não produz o motivo novo) | ≤ 100ms | ✅ | `migrations/0059_excecao_permuta.sql:96-97`; teto teórico ~1M rows/s |
| Custo do `VALIDATE CONSTRAINT` em `permuta_candidata_snapshot` | Estimado 200–800ms hoje, crescendo linear (sem retention). Estimativa: 3 runs/dia × ~800 candidatas × 90 dias ≈ 216k rows; sem retention chega a ~430k em 6m. VALIDATE = seq-scan com AccessExclusiveLock durante o `ALTER TABLE ... VALIDATE`. Precedente similar aceito em 0054:256 | ≤ 1s no deploy | ⚠️ | `migrations/0059_excecao_permuta.sql:99-100`; ausência de política de retenção em `permuta_candidata_snapshot` (ver F-performance-2) |
| Bundle FE — dialogs carregados sob demanda? | Sim: `ExcecaoManualDialog` e `DesfazerExcecaoDialog` via `next/dynamic` — não entram no chunk inicial da rota | Componentes que abrem via user gesture NÃO no first-load JS | ✅ | `app/permutas/page.tsx:98-104` |
| Re-renders do `page.tsx` (1083 LOC) por state da exceção | 4 novos `useState` no `useExcecaoManual` (`marcandoExcecao`, `salvandoExcecao`, `desfazendoExcecao`, `removendoExcecao`). Cada `set` dispara re-render da árvore do `/permutas`. `VisaoGeralTable` recebe ~10 props e não é `React.memo` | Δ re-render ≤ 16ms para 50 linhas visíveis (`PAGE_SIZE=50`) | ⚠️ Não medível localmente | `useExcecaoManual.ts:16-19`, `VisaoGeralTable.tsx:34` (sem `React.memo`) |
| p95/p50 real dos endpoints em produção | Não medível localmente (Render + Supabase — sem instrumentação exposta no repo) | p95 `/gestao` ≤ 800ms | ⚠️ Não medível localmente | Requer painel Render/Supabase ou APM. Feature não adiciona instrumentação. |

> ⚠️ **Não medível localmente**: p95 real dos endpoints, tamanho do bundle Next após build (o
> worktree não é o checkout do dev — não rodo `next build` aqui — mas o padrão de `dynamic()` é
> a melhor prática do delta e já cobre o caminho quente). Cardinalidade real de
> `permuta_candidata_snapshot` idem — usei estimativa a partir de "3×/dia × ~800 candidatas".
> Recomendação em cards abaixo.

## 3. Tactics — Cobertura no nf-projects

Escopo restrito às tactics tocadas pelo delta.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Reduce Overhead | `Promise.all` de 9 leituras em `exporGestao` embute o `listAtivas` novo sem serialização; pós-passe da eleição é `map` puro sobre coleção já materializada — reusa a mesma `candidatas` que segue para `contarPorEstado`/snapshot | ✅ presente | `GestaoPermutasService.ts:80-103`, `EleicaoPermutasService.ts:406,411-414` |
| Increase Resource Efficiency | Índice parcial `uq_permuta_excecao_manual_ativa … WHERE removido_em IS NULL` casa 1:1 com o predicado do `listAtivas`/`findAtiva`; `reclassificarAdiantamento` faz UPDATE por PK (`doc_cod`) com trava otimista (`WHERE ... estado_elegibilidade = $de` + `AND motivo_bloqueio = $de`) — sem varredura | ✅ presente | `migrations/0059_excecao_permuta.sql:66-68`, `PermutaRelationalRepository.ts:629-641` |
| Bound Execution Times | Todas as queries do delta são bounded: `listAtivas` pelo índice parcial (≤ 1 ativa/adto); `findAtiva`/`findAdiantamento` por PK; UPDATEs por PK; VALIDATE CONSTRAINT do deploy com `NOT VALID`+`VALIDATE` (não escala com o backlog da run em curso) | ✅ presente | `ExcecaoPermutaRepository.ts:40-49`, `migrations/0059_excecao_permuta.sql:75-100` |
| Manage Sampling Rate | `listAtivas` chamado 1× por run e 1× por leitura do painel — não por candidata (evita N+1 explícito). `guardaSatisfeita` é predicado puro em memória, aplicado por candidata sem I/O | ✅ presente | `EleicaoPermutasService.ts:437-438`, `ExcecaoPermutaService.ts:72-73,86-105` |
| Limit Event Response | Guarda I-Exc-1 no serviço + índice parcial no banco recusam ação em estado errado (422/409) antes de qualquer trabalho pesado; log estruturado do aviso é `warn`, não `error`, não amplifica em pager | ✅ presente | `ExcecaoPermutaService.ts:123-133`, `EleicaoPermutasService.ts:443-457` |
| Increase Concurrency | `Promise.all` das 9 leituras do `/gestao` já paraleliza o `listAtivas` novo sem custo extra de latência | ✅ presente | `GestaoPermutasService.ts:81-103` |
| Prioritize Events | N/A — não há competição de eventos aqui. As rotas de marcar/desfazer são admin de baixa frequência | N/A | Feature é CRUD admin + pós-passe de run |
| Maintain Multiple Copies of Data | N/A — nenhuma cópia/cache novo. Um `Map<docCod,ExcecaoPermuta>` é construído por request em `exporGestao`, mas é lifecycle da request, não cache | N/A | `GestaoPermutasService.ts:104-106` |
| Bound Queue Sizes | N/A — caminho síncrono HTTP; não há fila | N/A | Sem SQS/EventBridge no stack real |
| Schedule Resources | N/A — sem novos jobs | N/A | Feature só adiciona pós-passe num compute já agendado (cron 3×/dia) |

## 4. Findings (achados)

### F-performance-1: `listAtivas` sem `LIMIT` explícito, bounded apenas por invariante de banco

- **Severidade**: P3 (baixo — bounded na prática, mas o "porquê" mora no schema, não no SQL)
- **Tactic violada**: nenhuma (a decisão está correta — só documentação)
- **Localização**: `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:28-37`
- **Evidência (objetiva)**:
  ```sql
  SELECT id, adiantamento_doc_cod, justificativa, criado_por, criado_em,
         removido_por, removido_em
    FROM permuta_excecao_manual
   WHERE removido_em IS NULL
   ORDER BY criado_em DESC
  -- sem LIMIT
  ```
  O índice parcial `uq_permuta_excecao_manual_ativa (adiantamento_doc_cod) WHERE removido_em IS NULL`
  (migration 0059:66-68) garante no máximo 1 ativa por adto; guarda I-Exc-1 restringe a origem
  a `bloqueada/sem-saldo-permutar` (universo prático estimado: 1–20 no caso motivador).
- **Impacto técnico**: Um bug no domínio (ex.: guarda removida, novo caminho de escrita)
  transformaria o `SELECT *` num scan de toda a coluna ativa. Sem `LIMIT`, o ceiling é dado
  pelo schema, não pelo próprio SQL — quem lê o repositório precisa saber do índice parcial.
- **Impacto de negócio**: Nenhum no cenário atual.
- **Métrica de baseline**: Universo estimado ≤ 20 linhas. Query < 5ms sob índice parcial.

### F-performance-2: `permuta_candidata_snapshot` cresce sem retention — VALIDATE CONSTRAINT escala linear

- **Severidade**: P2 (médio — débito acumulativo, chega ao limite em 6–12m)
- **Tactic violada**: Bound Execution Times (do deploy, não do runtime)
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql:99-100` (o próprio delta)
  + `migrations/0001_permuta_eleicao.sql:26-40` (tabela sem retention)
- **Evidência (objetiva)**:
  ```sql
  ALTER TABLE permuta_candidata_snapshot
      VALIDATE CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado;
  ```
  A tabela é populada em `PermutaSnapshotRepository.persistRun` sem `DELETE` acumulativo:
  cada run adiciona ~800 linhas; 3 runs/dia × 90 dias ≈ **216k rows** hoje; 6m ≈ **430k**;
  1 ano ≈ **870k**. `VALIDATE CONSTRAINT` faz seq-scan com `AccessExclusiveLock` (breve, mas
  bloqueia writes na tabela pelo tempo do scan).
- **Impacto técnico**: Nesta deploy, custo estimado 200–800ms — aceitável. Em migrations
  futuras que precisem redefinir CHECKs (como 0054, 0055 e agora 0059 fizeram), o custo
  aumenta linear com o crescimento. Sem retention, chega em segundos em ~1 ano.
- **Impacto de negócio**: Janela de deploy alonga; nenhum impacto de runtime hoje.
- **Métrica de baseline**: ~216k rows estimados hoje; crescimento ~2.4k rows/dia; VALIDATE
  em ~200k rows ≈ 200–500ms (seq-scan + CHECK simples). Sem instrumentação local — número
  vem de heurística Postgres ~1M rows/s em CHECK escalar.

### F-performance-3: Página `/permutas` sem memoização — 4 useState novos re-renderizam árvore inteira

- **Severidade**: P3 (baixo — `PAGE_SIZE=50` limita o custo do frame)
- **Tactic violada**: Reduce Overhead (frontend)
- **Localização**: `src/frontend/app/permutas/components/useExcecaoManual.ts:16-19`,
  `src/frontend/app/permutas/page.tsx:349-358`, `VisaoGeralTable.tsx:34-70`
- **Evidência (objetiva)**:
  ```tsx
  const [marcandoExcecao, setMarcandoExcecao] = React.useState<PermutaPendente | null>(null)
  const [salvandoExcecao, setSalvandoExcecao] = React.useState(false)
  const [desfazendoExcecao, setDesfazendoExcecao] = React.useState<PermutaPendente | null>(null)
  const [removendoExcecao, setRemovendoExcecao] = React.useState(false)
  ```
  Cada `set*` re-renderiza `page.tsx` (1083 LOC) inteiro. `VisaoGeralTable` (545 LOC, ~10
  props) NÃO é `React.memo` nem tem `useMemo` interno. Cada re-render reconstrói `filtered`,
  `pendentesPagina`, etc — 50 linhas por página (`PAGE_SIZE`).
- **Impacto técnico**: 50 `TableRow`s reconciliam por re-render. Custo desprezível (< 3ms/frame
  em máquina do analista). Só piora se `PAGE_SIZE` subir ou se `VisaoGeralTable` ganhar mais
  colunas — cenário improvável no delta.
- **Impacto de negócio**: Nenhum observável.
- **Métrica de baseline**: Não instrumentada. Big-O: O(50 × 14 colunas × ~4 re-renders/ação).

### F-performance-4: `marcar` faz 3 reads pré-transação para depois abrir tx com 2 writes

- **Severidade**: P3 (baixo — rota admin, baixíssima frequência)
- **Tactic violada**: nenhuma (é o padrão de checagem-antes-de-escrever com mensagens
  distintas 404/422/409)
- **Localização**: `src/backend/domain/service/permutas/ExcecaoPermutaService.ts:117-164`
- **Evidência (objetiva)**:
  ```
  findAdiantamento(docCod)   ← read 1 (404 se ausente/stale)
  guardaSatisfeita(...)      ← predicado puro
  findAtiva(docCod)          ← read 2 (409 se ativa)
  withTransaction:
    INSERT permuta_excecao_manual                  ← write 1
    UPDATE permuta_adiantamento SET estado/motivo  ← write 2
  ```
  Poderia ser 1 SELECT com CASE ou usar `INSERT ... RETURNING` para detectar 23505 e derivar
  os 3 casos. Não vale complicar: rota admin usada 1–5×/mês.
- **Impacto técnico**: 4 roundtrips ao banco (~4 × 2ms em Supabase mesma região ≈ 10ms). O
  `UNIQUE_VIOLATION` já é tratado no catch (`:151-155`) como último anteparo para corrida.
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: 4 roundtrips/marcar; ~10ms latência pura de banco (estimativa
  Supabase mesma-região).

### F-performance-5: Falta observabilidade de latência do `/gestao` e do pós-passe

- **Severidade**: P3 (baixo — não é regressão; é ausência de instrumentação)
- **Tactic violada**: (observabilidade da fronteira, não uma tactic pura)
- **Localização**: `GestaoPermutasService.ts:224-233` (log `BUSINESS_INFO` sem duração),
  `EleicaoPermutasService.ts:484-493` (tem `durationMs` em `FLOW_COMPLETE`, ✅)
- **Evidência (objetiva)**:
  ```typescript
  await this.logService.info({
      type: LOG_TYPE.BUSINESS_INFO,
      message: 'permuta gestao served',
      data: { requestId, pendentes, invoicesEmAberto, casamentos },
  });
  // sem durationMs
  ```
  `computeCandidatas` já loga `durationMs` (`:492`). O `/gestao` não.
- **Impacto técnico**: Impossível confirmar via logs que o `+1 listAtivas` não moveu o p95.
- **Impacto de negócio**: Cegueira futura ("quando começou a lentidão?").
- **Métrica de baseline**: 0 métricas de latência do `/gestao` no delta.

## 5. Cards Kanban

> Nenhum P0/P1 no delta. Toda a superfície de performance nova é bounded por índice parcial +
> guarda I-Exc-1, e o pós-passe é `map` puro sobre coleção já em memória. Os cards abaixo são
> **higiene** — arquivar em follow-ups; não re-entram no loop.

### [performance-1] Definir política de retenção para `permuta_candidata_snapshot`

- **Problema**
  > A tabela cresce ~2.4k linhas/dia sem retention. Cada migration futura que precise
  > `VALIDATE CONSTRAINT` (padrão adotado em 0054, 0055 e 0059) faz seq-scan sob
  > `AccessExclusiveLock` durante o scan. Estimativa: 216k rows hoje → 870k em 12m,
  > VALIDATE passa de ~200ms para ~1s. Custo é acumulativo e invisível até doer.

- **Melhoria Proposta**
  > Adicionar retenção (candidato: `DELETE ... WHERE run_id IN (SELECT id FROM
  > permuta_eleicao_run WHERE started_at < now() - INTERVAL '90 days')`) num job noturno
  > OU trocar por particionamento por `run_id`/mês. Não fazer aqui — decidir com o Yuri o
  > horizonte de auditoria aceitável (90d? 1y?). Documento em ADR.

- **Resultado Esperado**
  > VALIDATE CONSTRAINT em futuras migrations volta a ~200ms independente do calendário.
  > Backup Supabase encolhe proporcionalmente.

- **Tactic alvo**: Bound Execution Times (do deploy) + Increase Resource Efficiency
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — precisa ADR de horizonte + job noturno + teste)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Linhas em `permuta_candidata_snapshot`: crescimento linear → cap ~200k
  - Latência `VALIDATE CONSTRAINT` no deploy: hoje ~200–800ms → estável ≤ 200ms
- **Risco de não fazer**: Em 12m, VALIDATE de migrations futuras passa de segundos;
  janela de deploy alonga; backup Supabase infla. Nada explode, só piora devagar.
- **Dependências**: ADR sobre horizonte de retenção (auditoria vs custo).

### [performance-2] Instrumentar `durationMs` no `/gestao` (paridade com `FLOW_COMPLETE` da eleição)

- **Problema**
  > `GestaoPermutasService.exporGestao` loga `pendentes/invoicesEmAberto/casamentos` mas
  > não `durationMs` (`:224-233`). `EleicaoPermutasService` já loga (`:491`). Sem isto não
  > há como comparar p95 antes/depois do `+1 listAtivas` — nem de qualquer feature futura
  > que toque este endpoint.

- **Melhoria Proposta**
  > Adicionar `const t0 = performance.now()` no topo de `exporGestao` e `durationMs:
  > Math.round(performance.now() - t0)` no log. Copiar o padrão do `FLOW_COMPLETE`.

- **Resultado Esperado**
  > Baseline de p95 do `/gestao` conhecido via log; drift futuro detectável.

- **Tactic alvo**: Bound Execution Times (observabilidade da fronteira)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Log `permuta gestao served` passa a incluir `durationMs`
  - Painel de logs Render/Supabase mostra p95 do `/gestao`
- **Risco de não fazer**: Regressão futura no `/gestao` invisível até o analista reclamar.
- **Dependências**: nenhuma.

### [performance-3] Comentar o `SELECT sem LIMIT` do `listAtivas` amarrando ao índice parcial

- **Problema**
  > `ExcecaoPermutaRepository.listAtivas` não tem `LIMIT`. Hoje o boundary do universo mora
  > só no índice parcial e na guarda I-Exc-1 — a leitura precisa saber disso para não
  > desconfiar. Feature futura que quebre a unicidade (bug ou remoção da guarda) transforma
  > a query num scan silencioso.

- **Melhoria Proposta**
  > Adicionar comentário no método referenciando `uq_permuta_excecao_manual_ativa` e a
  > guarda I-Exc-1 como cerca do universo. Alternativa mais forte: `LIMIT 10000` explícito
  > + `logService.warn` se atingir o teto (canário barato). Preferir só o comentário se o
  > time considera o teto do índice parcial suficiente.

- **Resultado Esperado**
  > Próximo leitor descobre em 1 comentário por que a query é bounded sem `LIMIT`.

- **Tactic alvo**: Reduce Overhead (documentação como invariante)
- **Severidade**: P3
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Comentário/`LIMIT` amarrando os dois artefatos presente em `ExcecaoPermutaRepository`
- **Risco de não fazer**: Bem-baixo. Só reaparece se alguém tocar sem contexto.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Nenhum P0/P1**. Delta é conservador de performance: 1 query nova por run/leitura, bounded por
  índice parcial que casa 1:1 com o predicado; pós-passe é `map` puro; frontend usa `next/dynamic`
  para os dois modais novos (best-practice do delta).
- **Cross-QA**:
  - **Modifiability**: F-performance-2 (crescimento sem retention em `permuta_candidata_snapshot`)
    é também débito de schema — ADR de horizonte + job de purge é decisão de modificabilidade
    tanto quanto de performance. Sinal para `qa-modifiability`.
  - **Deployability**: Custo do `VALIDATE CONSTRAINT` no deploy (F-performance-2) é cross com
    Deployability — janela de manutenção alonga com o calendário. Sinal para `qa-deployability`.
  - **Testability/Observability**: Card `performance-2` (instrumentar `durationMs` do `/gestao`)
    sobrepõe com Testability — sem métrica não há como testar a hipótese "o `+1 listAtivas` custou
    ≤ 20ms de p95".
- **Métricas que tentei coletar e falhei**: p95 real dos endpoints (requer painel Render/Supabase),
  cardinalidade real de `permuta_candidata_snapshot` (não acessei DB de produção — decisão
  explícita do prompt), tamanho do bundle Next (não rodei `next build` no worktree). Estimativas
  rotuladas.
- **Decisão de escopo**: Não avaliei o caminho de `RelatorioExportService` além de confirmar que
  as 4 colunas novas (`excecaoManual/Justificativa/Autor/Data`) vêm de `p.excecaoManual` já
  carregado pelo `/gestao` — zero query extra no export. Custo O(N) por linha, N ≤ ~800.
