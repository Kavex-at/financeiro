---
qa: Testability
qa_slug: testability
run_id: 2026-08-28-1607
agent: qa-testability
generated_at: 2026-08-28T16:20:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Testability — Regis-Review

> Escopo: **DELTA** de 2 commits sobre `617ca3b` na branch `fix/conexos-fallback-audit`
> (worktree `~/kavex-worktrees/conexos-fallback-audit`), com flag `--quick` (sem coverage).
> Referência: `_shared-metrics.md`, `ontology/_inbox/conexos-fallback-audit-tasks.md` (T1/T2/T3),
> ADR-0041 + `business-rules/identidade-execucao-conexos.md`.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor mexendo em qualquer um dos 5 ledgers de execução (permuta / SN / recebimento / remessa / conciliação) | Muda a assinatura do `beginExecution`/`markSettled`/`markError` (novo parâmetro de identidade Conexos vindo do provider) | 5 `*ExecucaoRepository.ts` + 5 `*ExecucaoRepository.test.ts` + `ConexosIdentityProvider` + `ConexosSessionResolver` + migration `0051` | `npm test` local no `src/backend/` — sem live Postgres, sem AWS, sem SSM | Cada `beginExecution` / `markSettled` / `markError` que persiste as duas novas colunas tem um teste que **falha** se o SQL parar de escrever `conexos_username` / `conexos_usn_cod`, ou se a coluna sumir da migration | `# tests que falham por regressão em identidade` ≥ 1 **por ledger** (hoje: 4 de 5) e `# tests que falham se `0051` for revertida` ≥ 1 (hoje: 0) |

Bass — `Limit Structural Complexity` (`ConexosIdentityProvider` isolado, injetável) e `Specialized Interfaces` (o provider é a fake seam) foram aplicadas corretamente. Falha específica: `Executable Assertions` cobrem só 1 de 5 ledgers, e a migration não tem asserção nenhuma.

## 2. Métricas observadas

### 2.1 Cobertura de testes por camada — proxy por razão de arquivos (coverage report não rodado, `--quick`)

| Camada | Arquivos-fonte | `*.test.ts` | Razão | Alvo (mínimo) | Status | Fonte |
|---|---:|---:|---:|---:|---|---|
| `domain/service` | 50 | 41 | 0,82 | 0,50 | ✅ | `find src/backend/domain/service -name '*.ts'` |
| `domain/repository` | 21 | 19 | 0,90 | 0,50 | ✅ | `find src/backend/domain/repository -name '*.ts'` |
| `domain/client` | 21 | 15 | 0,71 | 0,50 | ✅ | `find src/backend/domain/client -name '*.ts'` |
| `domain/libs` | 13 | 8 | 0,62 | 0,50 | ✅ | `find src/backend/domain/libs -name '*.ts'` |
| `domain/repository/sispag` | 5 | 4 | 0,80 | 1,00 | ⚠️ | falta `ConciliacaoExecucaoRepository.test.ts` |
| `domain/repository/permutas` | 7 | 6 | 0,86 | 1,00 | ⚠️ | `NumerarioExecucaoRepository.ts` sem teste (fora do delta) |

> ⚠️ **Não medível localmente**: cobertura de linhas/branches/funcs (o alvo real da tactic `Executable Assertions`). Requer `npm test -- --coverage`, **vetado pela flag `--quick`**. Recomendação: rodar `npm test -- --coverage --collectCoverageFrom='src/backend/domain/repository/**/*.ts' --collectCoverageFrom='src/backend/domain/client/ConexosIdentityProvider.ts' --collectCoverageFrom='src/backend/domain/client/ConexosSessionResolver.ts'` na próxima passagem sem `--quick` — no delta os quatro repositórios mudados foram tocados **iguais** no source, só o de permuta ganhou asserção de saída, então a linha de cobertura vai empatar (~100%) mas a de **asserção comportamental** (o que este audit está medindo à mão) é 1/5.

### 2.2 Delta em unit tests

| Métrica | Valor | Alvo | Status | Fonte |
|---|---:|---|---|---|
| Suítes totais backend | 110 pass / 0 fail | 110 pass | ✅ | `npm test` no worktree, 15,3s |
| Testes totais backend | 1493 pass / 0 fail | 1493 pass | ✅ | idem |
| Novos test files no delta | 1 (`ConexosIdentityProvider.test.ts`) | ≥ 1 por novo seam | ✅ | `git diff main..HEAD --stat` |
| Novos test cases no delta | +4 (IdentityProvider) + 9 (SessionResolver: 6 I-1 + 3 identidade) + 4 (Permuta identidade) = **17** | — | ✅ | contagem manual |
| Tests com `container.resolve(` (integração disfarçada) em arquivos tocados no delta | 0 | 0 | ✅ | `grep -rn container.resolve src/backend/domain/repository src/backend/domain/client --include="*.test.ts"` |

### 2.3 Assimetria de cobertura das colunas de identidade — a métrica-chave deste review

Os 5 ledgers receberam **a mesma mudança de produção** (injeção do `ConexosIdentityProvider` + duas colunas em INSERT/UPDATE). Só 1 recebeu asserção correspondente no teste.

| Ledger (`*ExecucaoRepository`) | Mudança de produção (colunas gravadas) | Test file existe? | Asserções sobre `conexos_username` / `conexos_usn_cod` | Status |
|---|---:|:---:|---:|---|
| `permutas/PermutaExecucaoRepository` | +22 LOC (INSERT + markSettled + markError) | sim | **14** (4 novos `it()` cobrindo begin, settle, error, ausente) | ✅ |
| `recebimentos/RecebimentoExecucaoRepository` | +22 LOC (mesma cirurgia) | sim | **1** (só o stub `buildIdentity`) | ❌ |
| `recebimentos/SolicitacaoNumerarioExecucaoRepository` | +22 LOC | sim | **1** (só o stub) | ❌ |
| `sispag/RemessaExecucaoRepository` | +20 LOC | sim | **1** (só o stub) | ❌ |
| `sispag/ConciliacaoExecucaoRepository` | +27 LOC | **não** | 0 (arquivo de teste inexistente) | ❌❌ |

Razão de cobertura da nova invariante: **1 / 5 = 20 %**. Métrica-alvo: 100 %. Fonte: `grep -c "conexos_username\|conexosUsername\|conexosUsnCod\|conexos_usn_cod" <cada test file>`.

### 2.4 Cobertura dos critérios de aceite T1 / T2 / T3

Cada critério do `conexos-fallback-audit-tasks.md` foi mapeado para o(s) `it()` que o exerce.

| Task | Critério de aceite | Test que exerce | Status |
|---|---|---|---|
| T1 | SEM vínculo → robô, nenhum log | `SessionResolver.test.ts` — "usuário SEM vínculo → robô em silêncio" | ✅ |
| T1 | Fora de request → robô, nenhum log, `current()` undefined | `SessionResolver.test.ts` — "fora de request (job/cron)"; `IdentityProvider.test.ts` — "fora de request → undefined" | ✅ |
| T1 | `decrypt` falha → warn `motivo: 'decrypt'` | `SessionResolver.test.ts` — "senha não decifra" | ✅ |
| T1 | `ensureSid` rejeita → warn `motivo: 'login'` | `SessionResolver.test.ts` — "login do ERP falha" | ✅ |
| T1 | Warn nunca carrega a senha | `SessionResolver.test.ts` — "o warn NUNCA carrega a senha" | ✅ |
| T1 | Nenhum caminho passa a lançar | ⚠️ implícito (retorno `ROBOT` é assertado, mas não há `expect(...).not.toThrow()`) | ⚠️ |
| T1 | `current()` reflete `viaRobo: true` no fallback e `false` no vínculo válido | `SessionResolver.test.ts` — "publica a identidade resolvida" (2 casos) | ✅ |
| T2 | `ADD COLUMN IF NOT EXISTS` idempotente nas 5 tabelas | **nenhum** | ❌ |
| T2 | Colunas NULLABLE, sem default | **nenhum** | ❌ |
| T2 | Nenhum backfill, nenhum índice | **nenhum** | ❌ |
| T2 | `npm run migrate` aplica limpo sobre `0050` | manual (Postgres docker), sem asserção automatizada | ❌ |
| T3 | Vínculo válido → login do usuário + usnCod dele gravados | ⚠️ **só permutas** (via mock direto do provider — não end-to-end pelo resolver) | ⚠️ |
| T3 | Fallback → login do robô | ⚠️ só permutas | ⚠️ |
| T3 | `ON CONFLICT` de `settled` preserva identidade original | ⚠️ só permutas ("PRESERVA a identidade de uma linha settled") | ⚠️ |
| T3 | Identidade indisponível → colunas NULL, sem quebrar escrita | ⚠️ só permutas ("sem identidade grava NULL") | ⚠️ |
| T3 | `dry_run` não tratado de forma especial | ❌ nenhum teste amarra `dryRun: true` **à identidade** | ❌ |
| T3 | SQL 100% parametrizado | ✅ (as asserções pré-existentes de `expect(sql).not.toMatch(/'\s*\+|\$\{/)` valem) | ✅ |

Score-card: **9 de 17 critérios com asserção**; 3 parciais (T1-lança, T3-vínculo-válido, T3-fallback); 5 ausentes (T2 inteiro + T3-dryRun).

### 2.5 Determinismo e seams

| Métrica | Valor | Alvo | Status | Fonte |
|---|---:|---:|---|---|
| `new Date()` / `Date.now()` no source dentro do delta | 0 | 0 | ✅ | `git diff main..HEAD -- '*.ts' \| grep -E 'new Date\(\)\|Date.now'` |
| `Math.random` / `crypto.randomUUID` no source dentro do delta | 0 | 0 | ✅ | mesmo grep |
| `container.resolve` em arquivos de teste do delta | 0 | 0 | ✅ | `grep -c container.resolve …` |
| Instâncias construídas com DI manual (`new Repo(mockDb, mockIdentity)`) | 4/4 nos ledgers com teste | 5/5 | ⚠️ | inspeção manual |
| Uso de `AsyncLocalStorage` real nos testes (`conexosRequestContext.run(...)`) | sim, em `SessionResolver.test.ts` e `IdentityProvider.test.ts` | sim | ✅ | leitura direta |
| Fixtures de payload Conexos usadas nos testes do delta | 0 (o resolver mocka `ensureSid` inteiro) | ≥ 1 recorded case para `/login` | ⚠️ | inspeção |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `ConexosIdentityProvider` é uma interface especializada (`current()` / `currentParams()`) criada explicitamente **para** ser fakeada — não expõe o `AsyncLocalStorage` ao ledger. `buildIdentity()` mock cabe em 6 linhas. | ✅ | `src/backend/domain/client/ConexosIdentityProvider.ts:38-55` |
| Recordable Test Cases | Nenhum fixture recorded — o resolver é testado com stubs sintéticos de `ensureSid`/`decrypt`. Para I-1 (aviso de degradação) isso basta; para a identidade end-to-end deixa um gap. | ⚠️ parcial | ausência em `src/backend/domain/client/__fixtures__/` |
| Sandbox | Nenhum sandbox de Postgres neste repo (não há `docker-compose.test.yml`, não há `describe('integration: ...')` para migrations). A migration `0051` foi validada só à mão contra um docker local do Yuri (ver `_shared-metrics.md` linha 43). | ❌ | `find . -name docker-compose\*` → 0 hits |
| Executable Assertions | Presente e forte no `PermutaExecucaoRepository.test.ts` (asserta o SQL, os `CASE WHEN`, o `COALESCE`, os params) — e **ausente** nos outros 4 ledgers para a nova invariante (só o `buildIdentity()` stub, sem `expect`). | ❌ | `grep -c conexos_username src/backend/domain/repository/**/*.test.ts` = 14 permuta / 1 outros / 0 conciliação |
| Abstract Data Sources | `PostgreeDatabaseClient` é sempre injetado (jest.fn); a nova dependência (`ConexosIdentityProvider`) também. Nenhum ledger toca `Pool` direto. | ✅ | leitura dos 4 test files |
| Limit Structural Complexity | O provider **não** foi acoplado ao repositório via herança nem via singleton estático: DI limpa, uma responsabilidade (ler o store + achatar em `{ conexosUsername, conexosUsnCod }`). O acréscimo por repositório é 1 parâmetro + 1 spread. | ✅ | `ConexosIdentityProvider.ts` inteiro (56 LOC) |
| Limit Non-Determinism | `AsyncLocalStorage` é a única fonte ambiente introduzida; ela é controlada nos testes com `conexosRequestContext.run(...)`. O `usnCod` é lido da sessão viva no momento da leitura — decisão deliberada, testada em `IdentityProvider.test.ts` "lê o usnCod da sessão VIVA". | ✅ | `ConexosIdentityProvider.test.ts:23-54` |

## 4. Findings

### F-testability-1: 4 dos 5 ledgers gravam identidade Conexos sem NENHUM teste asserting a coluna

- **Severidade**: **P1**
- **Tactic violada**: `Executable Assertions`
- **Localização**:
  - `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.test.ts` (produção +22 LOC, teste com `buildIdentity()` mudo)
  - `src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.test.ts` (idem)
  - `src/backend/domain/repository/sispag/RemessaExecucaoRepository.test.ts` (idem)
  - `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts` — **arquivo de teste sequer existe** (nem antes do delta, nem depois)
- **Evidência (objetiva)**:
  ```
  grep -c "conexos_username|conexosUsername|conexosUsnCod|conexos_usn_cod" <cada test file>
    permutas/PermutaExecucaoRepository.test.ts       : 14
    recebimentos/RecebimentoExecucaoRepository       :  1  (só o stub buildIdentity)
    recebimentos/SolicitacaoNumerarioExecucaoRepository:  1
    sispag/RemessaExecucaoRepository.test.ts         :  1
    sispag/ConciliacaoExecucaoRepository.test.ts     : arquivo não existe
  ```
  O `PermutaExecucaoRepository.test.ts` tem 4 `it()` novos (begin preserva, markSettled COALESCE, markError COALESCE, sem identidade grava NULL). Os outros três repositórios executam **o mesmo SQL** (mesmo shape de `COALESCE(conexos_username, $conexosUsername)`) e o teste não checa nem que o parâmetro é passado.
- **Impacto técnico**: se alguém remover o `spread` de `identityProvider.currentParams()` de qualquer um dos 4 ledgers sem teste, o `npm test` continua verde e a coluna passa a gravar NULL em produção — regredindo silenciosamente a invariante-motivo de todo o delta (a de ADR-0041: "todo execução tem identidade capturada"). Bass é literal aqui: teste que não pode falhar não defende invariante nenhuma.
- **Impacto de negócio**: a próxima investigação como a de `MARILYN_MUTAFCI` (2026-08-25) fica cega de novo em qualquer frente que não seja permuta. Recebimento, SN e SISPAG (remessa+conciliação) são justamente **as frentes com mais volume de execução real**.
- **Métrica de baseline**: 1 ledger em 5 com asserção (20 %). Alvo: 5 em 5 (100 %). LOC de código de produção sem teste correspondente: **91 LOC** (22+22+20+27).

### F-testability-2: `ConciliacaoExecucaoRepository` inteira sem test file (P0 estrutural, herdado, agora acumula)

- **Severidade**: **P1** (herdado; o delta não é a causa, mas amplia o débito)
- **Tactic violada**: `Executable Assertions`, `Abstract Data Sources`
- **Localização**: `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.ts` (180 LOC, 0 tests). É o único dos 5 ledgers `Execucao*` sem `.test.ts`.
- **Evidência (objetiva)**:
  ```
  ls src/backend/domain/repository/sispag/
    ConciliacaoExecucaoRepository.ts        ← sem .test.ts
    LotePagamentoRepository.test.ts
    LotePagamentoRepository.ts
    PagamentoIngestaoRunRepository.test.ts
    PagamentoIngestaoRunRepository.ts
    RemessaExecucaoRepository.test.ts
    RemessaExecucaoRepository.ts
    TituloAPagarRepository.test.ts
    TituloAPagarRepository.ts
  ```
  A conciliação do retorno SISPAG é a etapa que **fecha** o lote (settled/error); um repositório de settlement sem teste é o caso-canônico da métrica de Bass "layer com < 30 % coverage" ativa. Diferente dos outros três ledgers do F-1, aqui não há sequer `beginExecution`/`markError` cobertos pelo comportamento existente — nem herança de asserção há.
- **Impacto técnico**: qualquer bug em `beginExecution` (preservar `settled`), `settle` (transição de status), `fail` (COALESCE de handles) ou nas novas colunas de identidade **passa por qualquer PR sem gate**. `ConciliacaoRetornoService.test.ts` até mocka o ledger, mas mockar a interface não valida a implementação SQL.
- **Impacto de negócio**: a conciliação SISPAG é a etapa em que o lote deixa de estar em `reconciling` e vira `settled`/`error` — a regressão silenciosa aqui produz lote preso indefinidamente (o `reaper-sispag-reconciling.ts` até chama esse repo). O delta atual adiciona 27 LOC de código de produção nesse arquivo sem nenhum gate automatizado.
- **Métrica de baseline**: `describe(...)` = 0, `it(...)` = 0, LOC testados = 0/180.

### F-testability-3: migration `0051` sem asserção automatizada — validada só à mão contra um docker local

- **Severidade**: **P2**
- **Tactic violada**: `Sandbox`
- **Localização**: `src/backend/migrations/0051_execucao_identidade_conexos.sql`; toda a pasta `src/backend/migrations/` (nenhuma migration deste repo tem teste de aplicação).
- **Evidência (objetiva)**:
  ```
  find . -name docker-compose\*      → 0 hits
  find src/backend -name '*migration*test*' -o -name '*migrate*test*'   → 0 hits
  grep -rn "describe('integration:" src/backend --include='*.test.ts'   → 0 hits
  ```
  `_shared-metrics.md` linha 43: "Migration `0051` ✅ aplicada em Postgres LOCAL (docker) sobre schema em `0050`". Não há teste que **falharia** se alguém, em uma PR futura, mudar `ADD COLUMN IF NOT EXISTS` para `ADD COLUMN` (quebrando idempotência) ou adicionar um `NOT NULL DEFAULT 'MPS_ROBO'` (violando o requisito de "NULL = não capturada, nunca robô" da própria SQL).
- **Impacto técnico**: o critério T2 inteiro ("ADD COLUMN IF NOT EXISTS", "NULLABLE sem default", "sem backfill / sem índice", "aplica limpo sobre 0050") é validado 100 % à mão. Regressão em uma migration futura re-quebra qualquer uma dessas quatro propriedades sem gate.
- **Impacto de negócio**: idempotência quebrada = incidente no próximo `npm run migrate` de dev; default incorreto = 6 semanas de execução gravando `MPS_ROBO` como se fosse identidade capturada, poluindo a trilha exatamente como o incidente de `MARILYN_MUTAFCI`.
- **Métrica de baseline**: 0 testes de migration em `src/backend/migrations/` (das 51 migrations). Alvo mínimo: 1 script `test:migrations` que aplica todas contra um Postgres docker `test`, re-aplica (verifica idempotência) e roda `\d+` para checar shape.

### F-testability-4: identidade end-to-end (do resolver ao ledger) não é exercitada por nenhum teste

- **Severidade**: **P2**
- **Tactic violada**: `Executable Assertions`, `Specialized Interfaces` (fake usado no lugar do fio real)
- **Localização**: `src/backend/domain/service/**/*.test.ts` — nenhum service test do delta faz o fio `route → conexosRequestContext.run → resolve → beginExecution → markSettled` de ponta a ponta com asserção sobre `conexos_username` chegando ao Postgres (mockado).
- **Evidência (objetiva)**:
  ```
  grep -c "conexos_username|conexosUsername|conexosUsnCod|ConexosIdentityProvider" \
      src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts \
      src/backend/routes/sispag.test.ts
    → 0 0
  ```
  Os critérios T3 "vínculo válido → login do usuário + usnCod dele" e "fallback → login do robô" só passam por testes de **repositório** (permutas), que mockam o provider e nunca exercitam o resolver. Se o resolver parar de publicar `state.identity` (por exemplo, alguém troca `state.identity = ...` por `Object.assign(state, {identity: ...})` num refactor que quebre o proxy do ALS), o teste do provider continua verde (ele só lê o store) e o teste do repo continua verde (ele só lê o mock).
- **Impacto técnico**: o encanamento entre as 3 peças (`SessionResolver` publica, `IdentityProvider` lê, `ExecucaoRepository` persiste) é validado peça a peça mas **nunca é fechado** por um teste. Um refactor que mova a publicação para um lugar errado (por exemplo, esquecer de setar `identity` no caminho `state.platformUsername === undefined`) não é detectável.
- **Impacto de negócio**: mesma sintomatologia de F-1 e F-2: a identidade some do ledger e a próxima investigação fica cega. Distinto porque não é ausência de asserção — é ausência de teste **de integração leve** (dois seams reais + repo com PG mockado) que ligue as três peças.
- **Métrica de baseline**: 0 testes end-to-end da identidade. Alvo: 1 por ledger (5) ou 1 que rode uma matriz `[vínculo válido, decrypt-fail, login-fail, sem-vínculo, fora-de-request] × [begin, settle]`.

### F-testability-5: critério T1 "nenhum caminho passa a lançar" sem asserção explícita

- **Severidade**: **P3**
- **Tactic violada**: `Executable Assertions`
- **Localização**: `src/backend/domain/client/ConexosSessionResolver.test.ts:139-163` (blocos `decrypt`/`login`).
- **Evidência (objetiva)**: os testes de I-1 assertam `expect(out).toBe(ROBOT)` — o que exige que a promise resolva, mas não é o mesmo que `expect(...).resolves.not.toThrow()`. Se um refactor tornar `avisarDegradacao` capaz de lançar (por exemplo, `LogService.warn` rejeitando), o teste falha por motivo indireto (jest rethrow) e não explicita a invariante.
- **Impacto técnico**: baixo — a asserção existente cobre o caminho happy do log, mas a semântica "o log NUNCA derruba a execução" fica implícita.
- **Impacto de negócio**: baixo — se o log lançar, o warn some (já é o caso hoje em qualquer degradação), e o comportamento observável (retornar o robô) é preservado.
- **Métrica de baseline**: 0 asserções do tipo "quando `logService.warn` rejeita, `resolve()` ainda devolve `ROBOT`". Alvo: 1 caso `it('log falhar não derruba a execução', …)`.

## 5. Cards Kanban

### [testability-1] Fechar a assimetria dos 4 ledgers: asserção da identidade no SQL

- **Problema**
  > 4 dos 5 ledgers de execução (`Recebimento`, `SolicitacaoNumerario`, `Remessa`, `Conciliacao`) recebem no delta o mesmo `+22..+27 LOC` de produção que o `PermutaExecucaoRepository` — injeção do `ConexosIdentityProvider` e gravação de `conexos_username`/`conexos_usn_cod` em `beginExecution`/`markSettled`/`markError` — mas o `.test.ts` deles só ganhou um `buildIdentity()` mudo. `grep -c conexos_username` devolve **14** no de permuta e **1** em cada um dos outros três; qualquer regressão que pare de passar `conexosUsername` como parâmetro passa por `npm test` verde. É o findings F-testability-1.
- **Melhoria Proposta**
  > Portar os 4 `it()` de identidade do `PermutaExecucaoRepository.test.ts` (linhas 350-425 no diff) para os outros três test files, adaptando o shape esperado: "begin grava as duas colunas e PRESERVA no `ON CONFLICT` settled", "markSettled/markError usam `COALESCE(coluna, $novo)`", "sem identidade grava NULL". Manter o mesmo mock local `identidade(username, usnCod)`. Tactic Bass: `Executable Assertions`.
- **Resultado Esperado**
  > Razão de cobertura da nova invariante: **1/5 (20 %) → 4/5 (80 %)** (o 5º está no card testability-2). `# it()` no total: **+12** (4 por repo × 3 repos). LOC de código de produção sem teste correspondente: **91 → 47** (o resto vai no card testability-2).
- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Asserções de identidade por test file: `Recebimento 1 → ≥ 4`, `SolicitacaoNumerario 1 → ≥ 4`, `Remessa 1 → ≥ 4`
  - Suítes: 110 → 110 (mesmas suítes, +12 tests)
  - Cobertura da nova invariante nos 5 ledgers: 20 % → 80 %
- **Risco de não fazer**: refactor futuro dos executores (SISPAG e Recebimentos são áreas ativas) pode remover o parâmetro `conexosUsername`/`conexosUsnCod` do SQL sem que nenhum teste dispare — reproduzindo a cegueira que motivou ADR-0041 justo nas 3 frentes de maior volume.
- **Dependências**: nenhuma (o `buildIdentity()` já está no lugar).

### [testability-2] Criar `ConciliacaoExecucaoRepository.test.ts` — repo do fechamento SISPAG sem NENHUM teste

- **Problema**
  > `ConciliacaoExecucaoRepository.ts` (180 LOC, 5 métodos públicos: `findByIdempotencyKey`, `listByStatus`, `listReconcilingParadas`, `beginExecution`, `settle`, `fail`) **nunca teve** test file — é o único dos 5 ledgers `*Execucao*` sem cobertura de unit test. O delta adiciona 27 LOC nele (colunas de identidade + provider) sem gate automatizado. É o repo que fecha o lote SISPAG (transiciona para `settled`/`error`); regressão aqui = lote preso em `reconciling` na conciliação de retorno, exatamente o cenário que o `reaper-sispag-reconciling.ts` existe para mitigar. F-testability-2.
- **Melhoria Proposta**
  > Criar `src/backend/domain/repository/sispag/ConciliacaoExecucaoRepository.test.ts` espelhando `RemessaExecucaoRepository.test.ts` (mesmo shape de repo `Execucao*` de SISPAG): asserções sobre `beginExecution` (write-ahead + preservar `settled` no `ON CONFLICT`), `settle` (SET `settled` + etapa), `fail` (COALESCE de handles), `findByIdempotencyKey`, `listByStatus`, `listReconcilingParadas` (auditoria de órfão). Incluir os 4 `it()` de identidade do card testability-1. Tactic Bass: `Executable Assertions` + `Abstract Data Sources`.
- **Resultado Esperado**
  > `describe(...)` = 0 → ≥ 3 (I-2 ledger, preservação de settled, identidade). `it(...)` = 0 → ≥ 12. Razão de cobertura da nova invariante nos 5 ledgers: **80 % → 100 %** (fecha o card testability-1). Cobertura por linha do repositório: 0 % → ~90 % (medível na próxima passagem sem `--quick`).
- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2, F-testability-1
- **Métricas de sucesso**:
  - `find … ConciliacaoExecucaoRepository.test.ts | wc -l`: 0 → 1
  - Suítes: 110 → 111
  - Tests: 1493 → ≥ 1505
- **Risco de não fazer**: bug em `settle`/`fail` da conciliação passa em qualquer PR; um `beginExecution` que regrida `settled` (o pior caso — segundo `processar` de um lote já baixado) fica indetectável.
- **Dependências**: nenhuma (o padrão do sibling `RemessaExecucaoRepository.test.ts` é copiável).

### [testability-3] Teste de aplicação de migrations em Postgres docker (`Sandbox`)

- **Problema**
  > Nenhuma das 51 migrations do repo tem teste de aplicação. `_shared-metrics.md` linha 43 registra que `0051` foi validada "em Postgres LOCAL (docker) sobre schema em `0050`" — validação à mão, sem gate automatizado. Não há `docker-compose.test.yml`, não há `describe('integration: ...')` nas migrations, não há script `test:migrations`. Os 4 critérios de T2 (`IF NOT EXISTS` idempotente, NULLABLE sem default, sem backfill/índice, aplica limpo sobre 0050) são todos validados manualmente. F-testability-3.
- **Melhoria Proposta**
  > Adicionar `src/backend/scripts/test-migrations.sh` que suba um Postgres docker efêmero (`postgres:16-alpine`), rode `migrations/migrate.ts` até `0051`, execute `\d+ permuta_alocacao_execucao` (e as outras 4) via `psql`, faça asserções sobre a presença/tipo/nullability de `conexos_username` e `conexos_usn_cod`, e re-rode `migrate.ts` para verificar idempotência (segunda aplicação = no-op). Publicar como target `npm run test:migrations` (fora do `npm test` default, para não exigir docker localmente). Adicionar chamada no CI (GitHub Actions do deploy Render). Tactic Bass: `Sandbox` + `Specialized Interfaces` (shape assertion sobre `information_schema.columns`).
- **Resultado Esperado**
  > `# testes de migration` no repo: 0 → 1 (script) cobrindo 51 migrations. Critérios T2 automatizados: 0/4 → 4/4. Deteção automática de: `ADD COLUMN` sem `IF NOT EXISTS`, `NOT NULL` sem default, `DEFAULT 'MPS_ROBO'` (violação da regra "NULL = não capturada").
- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — inclui subir docker no CI Render
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Migrations com asserção de shape: 0 → 51
  - Idempotência automatizada: sim
  - Tempo do gate no CI: alvo < 30s
- **Risco de não fazer**: uma migration futura remove `IF NOT EXISTS` (ou pior, adiciona `DEFAULT 'MPS_ROBO'`) e o problema só aparece 6 semanas depois quando alguém for auditar por identidade.
- **Dependências**: decisão do Yuri sobre docker no CI (o deploy é Render hook — o CI hoje é mínimo). Cross-QA: overlap com **Deployability** (gate antes de deploy) e com **Fault Tolerance** (invariante de idempotência).

### [testability-4] Teste de integração leve: resolver → provider → ledger com PG mockado

- **Problema**
  > As 3 peças novas — `ConexosSessionResolver` (publica `state.identity`), `ConexosIdentityProvider` (lê e achata em `currentParams`), `*ExecucaoRepository` (persiste as duas colunas) — são testadas peça a peça mas **nunca fechadas** por um teste que exercite as três com o `AsyncLocalStorage` real. Um refactor que quebre a publicação (por exemplo, `Object.assign(state, {identity})` vs `state.identity = …` num proxy) passa por todos os 17 tests novos. F-testability-4.
- **Melhoria Proposta**
  > Um novo test file (`ConexosIdentityFlow.test.ts`) que instancia `SessionResolver` + `IdentityProvider` reais (só `PostgreeDatabaseClient`, `UserRepository`, `ConexosSessionRegistry` mockados), roda `conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, async () => { await resolver.resolve(); await repo.beginExecution(...); await repo.markSettled(...); })` para uma matriz `[vínculo válido, decrypt-fail, login-fail, sem-vínculo, fora-de-request] × [Permuta, Recebimento, SolicitacaoNumerario, Remessa, Conciliacao]` e asserta os parâmetros do INSERT/UPDATE mockado. Tactic Bass: `Executable Assertions` + `Limit Structural Complexity` (o teste vira o gate do encanamento).
- **Resultado Esperado**
  > `# testes end-to-end da identidade`: 0 → 25 (5 cenários × 5 ledgers) ou pelo menos 5 (1 por ledger). Cobertura dos critérios T3 "vínculo válido → login do usuário" e "fallback → login do robô": mocks isolados → fio real. Refactor que quebre a publicação **falha** o teste.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-testability-4, F-testability-1
- **Métricas de sucesso**:
  - Testes end-to-end da identidade: 0 → ≥ 5 (1 por ledger)
  - Critérios T3 com asserção end-to-end: 0/2 → 2/2
- **Risco de não fazer**: refactor futuro do `ConexosRequestContext` (por exemplo, migrar para OpenTelemetry Context) quebra silenciosamente a publicação; as 5 frentes voltam a gravar NULL como se estivessem fora de request.
- **Dependências**: card testability-1 e testability-2 (o 5º ledger precisa ter test file).

### [testability-5] Asserção explícita "log falhar não derruba a execução" no `SessionResolver`

- **Problema**
  > O critério T1 "nenhum caminho passa a lançar" está implicitamente coberto pelo `expect(out).toBe(ROBOT)`, mas nenhum `it()` explicita "quando `logService.warn` rejeita, `resolve()` ainda devolve o robô". Se a `avisarDegradacao` for refatorada para `await` sem `try/catch`, o log passa a poder derrubar a execução — regredindo silenciosamente a invariante "o registro do fallback NUNCA interrompe o usuário". F-testability-5.
- **Melhoria Proposta**
  > Um `it('quando o log de degradação falha, a execução ainda cai no robô', …)` em `ConexosSessionResolver.test.ts` — configurar `logService.warn.mockRejectedValue(new Error('log offline'))`, disparar o caminho de `login`-fail dentro de `conexosRequestContext.run`, `expect(resolver.resolve()).resolves.toBe(ROBOT)`. Tactic Bass: `Executable Assertions`.
- **Resultado Esperado**
  > `# asserções "log falhar não derruba"`: 0 → 1 nos dois motivos (`decrypt` e `login`, idealmente ambos). Critério T1 "nenhum caminho passa a lançar": ⚠️ → ✅.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Tests: +1 (ou +2 se cobrir os dois motivos)
  - Todos os 7 critérios T1 com asserção explícita: 6/7 → 7/7
- **Risco de não fazer**: baixo (a semântica está no código; só a asserção é implícita) — mas é o tipo de invariante que um refactor de logging pode quebrar sem que ninguém perceba.
- **Dependências**: nenhuma.

## 6. Notas do agente

- `--quick` vetou coverage report — a "cobertura por camada" está reportada como razão de arquivos, não de linhas. Recomendo rodar sem `--quick` na próxima passagem para confirmar que os 4 ledgers cobertos pelo card testability-1 batem em ~90 % de linha (o SQL é curto).
- O `ConexosIdentityProvider` é um dos melhores exemplos de `Specialized Interfaces` no repo — 56 LOC, uma responsabilidade, mock cabe em 6 linhas. Vale citar como padrão-referência em revisões futuras.
- Cross-QA detectados para o `qa-consolidator`:
  - **testability-3 ↔ Deployability**: gate de migration é gate antes de deploy.
  - **testability-3 ↔ Fault Tolerance**: idempotência de migration é invariante de recuperação.
  - **testability-4 ↔ Modifiability**: teste end-to-end é o gate de refactor do `ConexosRequestContext`.
  - **testability-1/2 ↔ Fault Tolerance**: os 5 ledgers **são** a state machine `beginExecution → settled/error`; cobertura assimétrica das transições é gap direto de fault tolerance.
- O findings F-1 é o "genuíno" apontado pelo prompt: mesma mudança de produção em 5 ledgers, asserção só em 1. É a métrica mais defensável deste review.
