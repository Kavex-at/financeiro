---
qa: Performance
qa_slug: performance
run_id: 2026-09-28-2158
agent: qa-performance
generated_at: 2026-09-28T21:58:00-03:00
scope: backend
score: 6
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Navegador do analista/admin autenticado | Requisição a qualquer uma das 85 rotas autenticadas, em rajada logo após um deploy/restart (cache em memória zerado) ou ao carregar uma tela que dispara chamadas paralelas (ex.: SISPAG faz `Promise.all([fetchSispagPainel(), recarregarLotes()])`) | `resolverAcesso` (middleware) → `AccessService.resolver` (cache 30 s) → `AccessRepository.findAccessBySub` → pool Postgres (`max = 5`, compartilhado com toda query de negócio) | Produção, 1 instância Render (`plan: starter`, sem `numInstances`), ~15 usuários (14 ativos) | O middleware deveria resolver o acesso de cada usuário distinto com **no máximo uma** ida ao banco por janela de cache, sem competir pelas mesmas 5 conexões que as queries de negócio | 0 timeouts de pool (`connectionTimeoutMillis = 5000`) atribuíveis à resolução de acesso; ≤ 1 query de acesso por usuário por 30 s, mesmo sob chamadas paralelas do mesmo usuário |

> Este QA foi escopado ao delta (`git diff 4c6b34f..HEAD`), conforme instrução do orquestrador:
> `AccessService`/`AccessRepository`/`resolverAcesso` (auth por permissão), `lockAndCheck` (guarda
> R9), e o shape de `GET /usuarios`. Bundle/cold-start/SQS ficam fora — o backend ainda é Express
> (não Lambda) e este delta não toca fila alguma.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `poolMaxConnections` (pool compartilhado por TODA query, negócio + acesso) | 5 | ≥ pico de concorrência esperado em rajada pós-deploy | ⚠️ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:35` (pré-existente, não alterado neste delta) |
| `AccessService.CACHE_TTL_MS` | 30 000 ms | Adequado para ~15 usuários; revisitar se `numInstances` subir (a própria ADR já registra a ressalva) | ✅ | `src/backend/domain/service/auth/AccessService.ts` |
| Single-flight (coalescing) em cache miss de `AccessService.resolver` | Ausente — duas chamadas concorrentes com a mesma chave, ambas em miss, disparam 2 queries independentes | 1 query por chave em voo (promise compartilhada) | ❌ | `src/backend/domain/service/auth/AccessService.ts` (método `resolver`, linhas do `cache.get`/`await this.accessRepository.findAccessBySub`) |
| Chamadas paralelas ao backend por 1 carregamento de tela (exemplo real, SISPAG) | 2 (`Promise.all([fetchSispagPainel(), recarregarLotes()])`), cada uma passando por `resolverAcesso` de forma independente | 1, se o front deduplicasse, ou 2 sem custo extra no backend (com single-flight) | ⚠️ | `src/frontend/app/sispag/page.tsx:216` |
| Rotas autenticadas que agora pagam 1 lookup de acesso por requisição (era 0 — `requireRole` só lia o claim do JWT) | 85 | Aumento aceito pela ADR-0053 (I1); o risco é a ausência de single-flight, não o lookup em si | ✅ arquitetura / ⚠️ implementação | `_shared-metrics.md`, `src/backend/http/acesso.ts` |
| Escopo do `FOR UPDATE` em `lockAndCheck` (chamado por `setRole`, `replaceExceptions`, `deactivateGuarded`) | O(usuários ativos) = 14 em produção hoje, travados em toda escrita de acesso | O(1) ou O(gestores efetivos) para não degradar com o headcount | ⚠️ | `src/backend/domain/repository/auth/AccessRepository.ts` (`lockAndCheck`, `SELECT id FROM app_user WHERE ativo = true ... FOR UPDATE`) |
| `GET /usuarios` — linhas devolvidas por `listAll` + `listAccessForUsers`, sem `LIMIT`/paginação | 15 registros em produção hoje (tabela cresce com headcount, não com volume transacional) | Paginar (`Dynamic WHERE Pattern`, CLAUDE.md) antes do padrão ser reaproveitado numa tabela de alta cardinalidade | ✅ hoje / ⚠️ padrão | `src/backend/domain/repository/auth/UserRepository.ts:listAll`, `AccessRepository.ts:listAccessForUsers` |
| Queries por `GET /usuarios` | 2, disparadas em paralelo (`Promise.all`) — sem N+1 | ≤ 2 | ✅ | `src/backend/domain/service/auth/UserAdminService.ts:202-217` |
| Índices cobrindo os filtros novos (`user_permission.user_id`, `app_role_permission.role_id`) | Cobertos pela PK composta (`(user_id, permission)` / `(role_id, permission)`), sem índice dedicado necessário no volume atual | 100% coberto | ✅ | `src/backend/migrations/0066_auth_permissoes_modulo.sql` |
| `statement_timeout` / timeout de query explícito no pool | Nenhum configurado (pré-existente, não alterado neste delta) | Definir um teto (ex.: alguns segundos) para que uma query de acesso lenta não prenda a conexão indefinidamente | ⚠️ não medível localmente (nenhuma query lenta observada em ambiente descartável) | `PostgreeDatabaseClient.ts` |
| Latência p95 real de `findAccessBySub` sob carga | — | < 20ms (query simples, `WHERE lower(username)=...` sobre índice único) | ⚠️ **Não medível localmente**: requer ambiente de carga/produção. Recomendação: medir via CloudWatch/APM do Render após o deploy, filtrando pela rota `resolverAcesso`. | `_shared-metrics.md` ("Não medível") |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há ingestão de eventos de alta frequência neste delta | N/A | — |
| Limit Event Response | Cache de 30 s no `AccessService` limita a taxa de leitura por usuário, mas sem limitar o número de requisições CONCORRENTES que podem cair em miss ao mesmo tempo | ⚠️ parcial | `AccessService.ts` (`CACHE_TTL_MS`, sem single-flight) |
| Prioritize Events | N/A — todas as 85 rotas passam pelo mesmo caminho de autorização sem fila de prioridade | N/A | — |
| Reduce Overhead | `ACCESS_STATE_SELECT` resolve usuário + papel + pacote + exceções numa única consulta (agregações `array_agg`/`json_agg`), evitando N+1 explícito | ✅ presente | `AccessRepository.ts` (`ACCESS_STATE_SELECT`) |
| Bound Execution Times | Nenhum timeout de statement explícito na query de acesso; o único teto é `connectionTimeoutMillis = 5000` do pool (tempo de espera por conexão, não de execução) | ⚠️ parcial | `PostgreeDatabaseClient.ts` (pré-existente) |
| Increase Resource Efficiency | `GET /usuarios` paraleliza as 2 queries com `Promise.all` em vez de sequenciar | ✅ presente | `UserAdminService.ts:203-206` |
| Increase Resources | Pool fixo em 5 conexões, não escala com a carga introduzida pelo novo lookup de acesso por requisição | ⚠️ parcial (fora do escopo do delta, mas o delta muda o padrão de uso desse recurso fixo) | `PostgreeDatabaseClient.ts:35` |
| Increase Concurrency | Ausência de single-flight em `AccessService.resolver` é o oposto desta tactic: 2+ requisições concorrentes do MESMO usuário em cache frio competem pela mesma conexão em vez de compartilhar 1 resultado em voo | ❌ ausente | `AccessService.ts` (`resolver`) |
| Maintain Multiple Copies of Computations | O cache em memória de `AccessService` é, na prática, uma cópia computada do resultado do cálculo de permissões — presente, mas por processo (não distribuído) | ✅ parcial (ressalva de instâncias já documentada na ADR) | ADR-0053 D4 |
| Maintain Multiple Copies of Data | N/A — não há réplica de leitura nem cache distribuído (Redis) para o estado de acesso; decisão consciente da ADR (custo vs. benefício com ~15 usuários) | N/A (justificado) | ADR-0053 "Alternativas consideradas" |
| Bound Queue Sizes | Pool `pg` enfileira internamente até `connectionTimeoutMillis`; não há fila explícita de aplicação | ⚠️ parcial (comportamento default do driver) | `PostgreeDatabaseClient.ts` |
| Schedule Resources | `lockAndCheck` serializa TODAS as escritas de acesso (papel, exceções, desativação) através do mesmo lock de linhas ativas — mais uma tactic de exclusão mútua que de escalonamento, mas cumpre papel equivalente para o caso de uso | ✅ presente, com ressalva de escala | `AccessRepository.ts` (`lockAndCheck`), ADR-0053 D6 e "Consequências" |
| Cold start budget | N/A neste delta — backend roda como Express no Render, não como Lambda (estado "alvo", não atual, por `CLAUDE.md`) | N/A (justificado) | `CLAUDE.md` — tabela "Estado Atual vs. Alvo" |
| Cache strategy | Cache de 30 s por usuário, invalidado no processo após toda escrita da tela; falha fechada (503) quando o banco não responde | ✅ presente, com lacuna de single-flight | `AccessService.ts`, `acesso.ts` |
| Index discipline | As duas tabelas novas (`app_role_permission`, `user_permission`) só são filtradas pela própria PK composta — sem índice extra necessário no volume atual; `app_user_access_event` tem índice dedicado para a trilha | ✅ presente | `migrations/0066_auth_permissoes_modulo.sql` |
| Bundle leanness | N/A neste delta — sem Lambda, sem bundle por função; o delta acrescenta poucas dependências novas (sem nova lib de runtime) | N/A (justificado) | `src/backend/package.json` (não tocado pelo delta) |

## 4. Findings (achados)

### F-performance-1: `AccessService.resolver` sem single-flight — cache miss vira rajada de queries contra um pool de 5 conexões

- **Severidade**: P1
- **Tactic violada**: Increase Concurrency / Reduce Overhead
- **Localização**: `src/backend/domain/service/auth/AccessService.ts` (método `resolver`); `src/backend/domain/client/database/PostgreeDatabaseClient.ts:35` (`poolMaxConnections = 5`); exemplo de amplificação em `src/frontend/app/sispag/page.tsx:216`
- **Evidência (objetiva)**:
  ```ts
  // AccessService.ts — resolver()
  const hit = this.cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const access = await this.accessRepository.findAccessBySub(sub); // sem promise compartilhada
  ...
  this.cache.set(key, { value, expiresAt: now + AccessService.CACHE_TTL_MS });
  ```
  ```ts
  // sispag/page.tsx:216 — 2 chamadas paralelas do MESMO usuário, cada uma
  // passando por resolverAcesso de forma independente
  const [p] = await Promise.all([fetchSispagPainel(), recarregarLotes()])
  ```
  O cache só é escrito DEPOIS que a consulta termina (`await` antes do `cache.set`). Duas
  requisições do mesmo usuário que cheguem antes desse `set` — seja por `Promise.all` do
  front, seja por qualquer instância reiniciada (cache em memória, zerado a cada deploy/restart,
  conforme a própria ADR-0053 D4) — cada uma executa `findAccessBySub` de forma independente,
  competindo pelas mesmas 5 conexões do pool que TODA a aplicação usa (negócio + acesso).
- **Impacto técnico**: em uma rajada pós-deploy (até 15 usuários ativos, cada um gerando ≥1
  requisição no primeiro minuto) ou em qualquer tela com chamadas paralelas (o exemplo do SISPAG já
  existe no código), o número de conexões demandadas simultaneamente pode superar as 5 disponíveis.
  O driver `pg` enfileira até `connectionTimeoutMillis = 5000ms`; acima disso, a query falha. Como o
  pool é COMPARTILHADO com toda query de negócio, uma rajada de autorização pode atrasar ou derrubar
  requisições completamente alheias à autenticação.
- **Impacto de negócio**: antes deste delta, `requireRole('admin')` lia só o claim do JWT — **zero**
  idas ao banco por requisição. Este delta introduz até 1 consulta de acesso por usuário a cada 30 s
  (aceito e justificado na ADR-0053), mas a falta de single-flight faz esse custo se multiplicar
  exatamente nos momentos de maior risco (logo após um deploy, quando o time mais precisa que o
  sistema responda). Na prática, um deploy mal cronometrado pode gerar lentidão ou 503 passageiro em
  telas sem relação com auth.
- **Métrica de baseline**: 2 chamadas concorrentes comprovadas em `sispag/page.tsx:216`; pool com
  `max = 5`; 14 usuários ativos em produção (ADR-0053) que perdem o cache simultaneamente a cada
  reinício de instância.

### F-performance-2: `lockAndCheck` trava TODAS as linhas de usuário ativas em toda escrita de acesso — contenção O(n) que cresce com o headcount

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency / Schedule Resources
- **Localização**: `src/backend/domain/repository/auth/AccessRepository.ts` (método `lockAndCheck`), chamado por `setRole`, `replaceExceptions` e `UserRepository.deactivateGuarded`
- **Evidência (objetiva)**:
  ```sql
  SELECT id FROM app_user
   WHERE ativo = true
   ORDER BY id
   FOR UPDATE
  ```
  Executado no INÍCIO de toda transação de `setRole`, `replaceExceptions` e
  `deactivateGuarded` — as três únicas escritas de acesso do sistema. `_shared-metrics.md` confirma
  o comportamento ao vivo: "corrida 'último gestor' 10/10 (...) sempre 1 sucesso + 1
  `LastUserManagerError`" — ou seja, a segunda escrita concorrente espera a primeira liberar o lock
  sobre TODAS as linhas ativas, mesmo quando as duas mexem em usuários diferentes e nenhum é gestor.
- **Impacto técnico**: com 14 usuários ativos hoje, o lock é trivial (a própria ADR-0053 já admite
  isso na seção "Consequências": "trivial com ~15 usuários; vira ponto de contenção só se a base
  crescer muito"). Mas o padrão é O(usuários ativos) por escrita — qualquer alteração de papel,
  exceção ou desativação por QUALQUER admin serializa com QUALQUER outra, mesmo sobre usuários
  totalmente diferentes, porque a trava é sobre a tabela inteira de ativos, não sobre o subconjunto
  que decide a invariante ("existe pelo menos 1 gestor ativo").
- **Impacto de negócio**: hoje, imperceptível (tela de gestão de usuários, uso esporádico, ~15
  linhas). Se a Columbia expandir o headcount com acesso à plataforma (ex.: papéis por filial, mais
  analistas), cada edição na tela de usuários passa a competir por um lock cada vez maior, e o tempo
  de resposta de `PATCH /usuarios/:id/papel` e `PUT /usuarios/:id/permissoes` degrada de forma
  proporcional ao número de usuários ativos, não ao número de escritas concorrentes reais.
- **Métrica de baseline**: escopo do lock hoje = 14 linhas (usuários ativos em produção, conforme
  ADR-0053); a própria ADR já reconhece o ponto de virada como "a base crescer muito", sem definir
  um número — esta é a lacuna que o card abaixo fecha.

### F-performance-3: `GET /usuarios` monta a listagem com duas consultas sem `LIMIT`/paginação

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency (índice/limite de leitura)
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts` (`listAll`), `src/backend/domain/repository/auth/AccessRepository.ts` (`listAccessForUsers`), consumidas em paralelo por `src/backend/domain/service/auth/UserAdminService.ts:202-217`
- **Evidência (objetiva)**:
  ```sql
  -- UserRepository.listAll — sem LIMIT
  SELECT id, username, role, ativo, created_by, created_at, conexos_username,
         email, email_updated_by, email_updated_at
    FROM app_user
   ORDER BY created_at DESC, id DESC
  ```
  ```sql
  -- AccessRepository.listAccessForUsers — sem LIMIT
  SELECT u.id, u.username, ... FROM app_user u JOIN app_role r ON r.id = u.role_id
   ORDER BY u.id
  ```
- **Impacto técnico**: nenhum hoje — 15 linhas em produção, tabela cresce com headcount (não com
  volume transacional das frentes). Diferente de uma tabela como `permuta`/`lote`, o crescimento
  aqui é lento e previsível.
- **Impacto de negócio**: baixo no curto prazo. O risco real é de precedente: o padrão "sem
  `LIMIT`" viola o `Dynamic WHERE Pattern` documentado no `CLAUDE.md` para outras entidades, e um
  copy-paste deste repositório para uma tabela de alta cardinalidade (ex.: um futuro histórico de
  login por usuário) herdaria a ausência de paginação sem que ninguém tivesse decidido isso de
  propósito.
- **Métrica de baseline**: 15 linhas em produção hoje (ADR-0053, "15 usuários (14 ativos)").

### F-performance-4: nenhum `statement_timeout` explícito protege a query de acesso (e as demais) de prender uma conexão do pool de 5

- **Severidade**: P3 (pré-existente; o delta apenas aumenta a frequência de uso do pool)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts` (não alterado por este delta)
- **Evidência (objetiva)**: `Pool({ ..., connectionTimeoutMillis: 5000, ... })` limita a ESPERA por
  uma conexão, mas nada limita o TEMPO DE EXECUÇÃO de uma query já em curso, incluindo
  `findAccessBySub`.
- **Impacto técnico**: uma query de acesso anormalmente lenta (ex.: sob lock prolongado do
  `lockAndCheck` de F-performance-2) prende uma conexão do pool de 5 até o fim da transação, sem
  teto.
- **Impacto de negócio**: risco composto com F-performance-1 — mais uma via pela qual o pool de 5
  conexões, agora sob maior pressão por causa do lookup de acesso por requisição, pode ficar
  temporariamente indisponível para o restante da aplicação.
- **Métrica de baseline**: não medível localmente (nenhuma query lenta observada no Postgres
  descartável usado na validação ao vivo). Declarado explicitamente como não medível.

## 5. Cards Kanban

### [performance-1] Coalescer chamadas concorrentes no `AccessService` (single-flight) antes de escrever no cache

- **Problema**
  > `AccessService.resolver` só grava no cache depois que a consulta termina. Duas requisições
  > concorrentes do mesmo usuário em cache frio (comprovado em código: `Promise.all` de
  > `sispag/page.tsx:216`; e garantido a cada deploy, já que o cache em memória zera no restart)
  > disparam duas idas ao banco em vez de compartilhar uma, competindo pelas mesmas 5 conexões do
  > pool usado por toda a aplicação.

- **Melhoria Proposta**
  > Guardar no `Map` do `AccessService` a **promise em voo**, não só o valor resolvido: no cache
  > miss, criar `const inflight = this.accessRepository.findAccessBySub(sub)`, colocar essa promise
  > (ou um wrapper) na entrada do cache imediatamente, e só substituir pelo valor final quando ela
  > resolver. Chamadas concorrentes com a mesma chave devem `await` a MESMA promise. Tactic alvo:
  > Increase Concurrency / Reduce Overhead. Arquivo: `src/backend/domain/service/auth/AccessService.ts`.

- **Resultado Esperado**
  > Chamadas concorrentes do mesmo usuário em cache frio: 2 queries → 1 query (medível pelo teste
  > unitário do `AccessService` disparando 2 `resolver()` em paralelo e contando chamadas ao
  > repositório mockado). Rajada pós-deploy com 14 usuários ativos: até 14 queries simultâneas →
  > no máximo 1 por usuário distinto, independentemente de quantas requisições concorrentes cada um
  > dispare.

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Queries de acesso por rajada de N requisições concorrentes do mesmo usuário: N → 1
  - Conexões do pool de 5 consumidas por chamada de tela com `Promise.all` (ex. SISPAG): 2 → 1 (mais rápido a segunda, que reaproveita a promise da primeira)
- **Risco de não fazer**: a cada deploy (e a cada tela com chamadas paralelas), o pool de 5 conexões
  — compartilhado com toda a lógica de negócio — sofre uma rajada evitável de contenção exatamente
  no momento em que o sistema está mais vulnerável (logo após subir).
- **Dependências**: nenhuma.

### [performance-2] Reduzir o escopo do lock em `lockAndCheck` para não crescer O(usuários ativos)

- **Problema**
  > Toda escrita de acesso (`setRole`, `replaceExceptions`, `deactivateGuarded`) trava, com
  > `FOR UPDATE`, TODAS as linhas de `app_user` ativas antes de checar a invariante "existe pelo
  > menos 1 gestor ativo". Hoje são 14 linhas (trivial); a própria ADR-0053 já registra que isso "vira
  > ponto de contenção só se a base crescer muito", sem quantificar o limite.

- **Melhoria Proposta**
  > Restringir o lock ao subconjunto relevante para a invariante — por exemplo, travar só os
  > usuários ativos que hoje têm `usuarios:gerenciar` efetivo (tipicamente poucos, mesmo com
  > headcount grande), em vez de todos os ativos. Alternativa mais simples: um advisory lock
  > (`pg_advisory_xact_lock`) dedicado à escrita de acesso, que serializa sem escalar com o número de
  > linhas. Tactic alvo: Increase Concurrency / Schedule Resources. Arquivo:
  > `src/backend/domain/repository/auth/AccessRepository.ts` (`lockAndCheck`).

- **Resultado Esperado**
  > Escopo do lock por escrita: O(usuários ativos) (14 hoje, crescendo com o headcount) → O(gestores
  > ativos) ou O(1) via advisory lock. Tempo de uma escrita de acesso sob concorrência não deve mais
  > crescer com o número TOTAL de usuários ativos, só com o número de gestores.

- **Tactic alvo**: Schedule Resources
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — exige revalidar as 10/10 corridas concorrentes já cobertas ao vivo
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Linhas travadas por escrita de acesso: 14 (todos os ativos) → número de gestores ativos (hoje, provavelmente ≤ 5)
  - Corridas concorrentes de "último gestor": mantém 10/10 corretas (nenhuma regressão na invariante)
- **Risco de não fazer**: se a Columbia expandir o número de usuários com acesso à plataforma, cada
  edição de papel/exceção/desativação na tela de usuários fica proporcionalmente mais lenta sob
  concorrência, mesmo quando as edições não têm relação entre si.
- **Dependências**: nenhuma, mas deve rodar contra o mesmo Postgres descartável usado na validação
  ao vivo original (ADR-0053) para reconfirmar as 10/10 corridas.

### [performance-3] Paginar `GET /usuarios` (ou documentar a isenção) antes do padrão se espalhar

- **Problema**
  > `UserRepository.listAll` e `AccessRepository.listAccessForUsers` fazem `SELECT` sem `LIMIT`,
  > contrariando o `Dynamic WHERE Pattern` (paginação por `LIMIT $X OFFSET $Y`) documentado no
  > `CLAUDE.md`. Hoje inofensivo (15 linhas, crescimento ligado a headcount), mas é um precedente de
  > código que outra feature pode copiar para uma tabela de alta cardinalidade.

- **Melhoria Proposta**
  > Adicionar paginação (`LIMIT`/`OFFSET`, com contrato de resposta incluindo total) a `listAll` e
  > `listAccessForUsers`, OU registrar explicitamente em comentário/ADR por que esta tabela está
  > isenta (crescimento ligado a headcount, não a volume transacional) para que o próximo
  > `/feature-new` que copiar o padrão saiba que a isenção não se aplica a ele. Tactic alvo: Increase
  > Resource Efficiency.

- **Resultado Esperado**
  > `GET /usuarios`: 2 consultas sem `LIMIT` → 2 consultas paginadas (página default 50) OU isenção
  > documentada explicitamente no código. De qualquer forma, o próximo repositório com tabela de
  > alta cardinalidade não herda a ausência de paginação por omissão.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) para a documentação da isenção; M (2-5d) para paginação real com contrato de frontend
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Linhas retornadas por `GET /usuarios` sem limite: ilimitado → paginado (50/página) OU isenção documentada com justificativa numérica (headcount, não volume)
- **Risco de não fazer**: baixo isoladamente; o risco é de precedente copiado para uma tabela que
  cresce com volume transacional, aí sim gerando um table-scan real em produção.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta (`--quick`, diretórios de `_shared-metrics.md`): pool de conexões,
  bundle/cold-start e SQS/EventBridge ficam fora — a query real de baseline (pool `max=5`) é
  pré-existente, mas o PADRÃO DE USO dela muda de forma relevante com este delta (autorização
  passa de 0 para até 1 consulta por requisição).
- F-performance-1 tem overlap direto com **Availability** e **Fault Tolerance**: pool exhaustion vira
  503 fail-closed (mesmo desenho da ADR-0053 D4) — o consolidador deve casar os dois achados, não
  duplicar o card.
- F-performance-3 tem overlap com **Modifiability**: o `Dynamic WHERE Pattern` do `CLAUDE.md` é
  convenção de schema-como-código; vale alertar o `qa-modifiability` se ele também tocou
  `UserRepository`/`AccessRepository`.
- Não foi possível medir latência real sob carga (sem ambiente de staging/produção acessível neste
  `--quick`); declarado explicitamente na tabela da seção 2 em vez de omitido.
