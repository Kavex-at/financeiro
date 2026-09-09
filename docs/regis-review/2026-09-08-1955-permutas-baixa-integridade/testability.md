---
qa: Testability
qa_slug: testability
run_id: 2026-09-08-1955-permutas-baixa-integridade
agent: qa-testability
generated_at: 2026-09-08T20:20:00-03:00
scope: backend+frontend
score: 8
findings_count: 7
cards_count: 4
---

# Testability — Regis-Review

Escopo: DELTA do commit `8b18686` (R-1 P0 serialização + R-2 terminal `parcial`). A review global do módulo permanece em `docs/regis-review/2026-09-08-1414-permutas/testability.md`; aqui julga-se **a qualidade dos testes que este delta adicionou**, não o inventário do módulo.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que altera o serviço de baixa (`ReconciliacaoPermutaService`, `PermutaExecucaoRepository`, migration 0054) | Refactor toca advisory lock, laço de resíduo, `assertCobertura`, ou o CHECK do status | Camada `service/permutas` + repository + migration + união `ExecucaoStatus` espelhada FE↔BE | CI local (`npm test` no worktree) antes do gate `Regis-Review` | O teste **falha** quando o invariante quebra: `1 handshake` em vez de 2 sob concorrência; `markParcial` em vez de `markSettled` com resíduo; 422 em vez de 500 no HTTP; badge FE distinto para `parcial-aguardando-finalizacao` | Baseline: **123 suites / 1.768 testes verdes** neste worktree · **28 testes novos** no delta cobrem R-1/R-2 · **0** regressões nos 1.740 testes pré-existentes |

## 2. Métricas observadas

Sem `--coverage` neste run (`--quick`). A cobertura do módulo permutas está no run anterior — **94,74 % stmts / 72,78 % branch** — e a área tocada por este delta é `service/permutas/*` + `repository/permutas/PermutaExecucaoRepository.ts` + `routes/permutas.ts`, todos dentro dessa faixa medida.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Suites verdes no worktree | 123/123 backend · 27/27 frontend | 100 % | ✅ | `_shared-metrics.md` |
| Testes verdes | 1.768 backend · 201 frontend | 100 % | ✅ | idem |
| Testes NOVOS neste delta (`it()`) | **46** em `ReconciliacaoPermutaService.test.ts` (era 23), **20** em `permutas-components.test.tsx`, **30** em `PermutaExecucaoRepository.test.ts`, **29** em `BorderoGestaoService.test.ts`, **9** em `ReconciliacaoLotePermutaService.test.ts`, **41** em `permutas.test.ts`, **3** em `frontend/lib/types.test.ts` | ≥1 por invariante novo (I-Recon-5, I-Recon-6/7, I-Write-8a/b, B1', C-4, C-6, C-8) | ✅ | `grep -c "^\s*it("` |
| Testes de **concorrência** no write path da permuta (R-1) | **4** (`ReconciliacaoPermutaService.test.ts:784/824/848/874`) | ≥1 provando serialização + ≥1 provando não-bloqueio inter-adto + ≥1 provando estabilidade da chave | ✅ | grep no arquivo |
| Ramos testados de `assertCobertura` (I-Write-8a) | 6 de 7 (fallback lista vazia, catch, título único real, quitado com face cheia, `pago===1` divergente, fronteira ±0,005, lote `[error, settled]`); **falta**: `pago===1` **dentro** da tolerância (não-warn assertion) | 100 % dos ramos observáveis | ⚠️ | leitura de `ReconciliacaoPermutaService.ts:677-719` + testes 895-1078 |
| Ramos testados do laço de resíduo → `markParcial` | 3 de 4 (parcial + WARN 4 campos, parcial preservado, parcial + borderô CANCELADO simetria); **falta**: `bxaCodSeqs` vazio em `parcial` (guarda `bxaCodSeqs[0] !== undefined ? {…} : {}` na linha 582 nunca é exercitada pelo ramo "sem seq") | 100 % dos ramos alcançáveis | ⚠️ | leitura de `ReconciliacaoPermutaService.ts:568-613` |
| Ramos testados de `borderoAindaValido` (T2 do run anterior) | **5/5** — cada ramo em `it()` próprio (`ReconciliacaoPermutaService.test.ts:1241-1300`); o P3 `testability-4` está **CERRADO** por este delta | 5/5 | ✅ | grep `borderoAindaValido` no teste + leitura |
| Asserções em `logService.warn` (BUSINESS_WARN) | **3** novas (concorrência 816, parcial 1147, pago=1 divergente 965); o card `testability-7` pedia ≥5 e o total sobe de 0 → 3 | ≥5 | ⚠️ | grep no arquivo |
| Guarda de paridade FE↔BE de uniões espelhadas à mão | **3 uniões** cobertas (`ExecucaoStatus`, `PermutaStatusBordero`/`PermutaStatus`, `LoteAdiantamentoStatus`) de **≥7** no `types.ts` (`StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`, `BorderoSituacao`, `RelatorioTipo` **não cobertas**) | ≥7/7 | ⚠️ | `grep "^export type" src/frontend/lib/types.ts` + leitura de `types.test.ts` |
| Teste da migration `0054_permuta_execucao_parcial.sql` | **0 (mock-apenas)** — o CHECK só é asserido por `sql.includes("...IN ('settled', 'parcial')")` em `PermutaExecucaoRepository.test.ts:42`, o que valida o TEXTO do SQL do repositório, não a semântica do CHECK no banco. `testability-9` do run anterior segue aberto. | ≥1 integração contra Postgres real que INSERE `'parcial'` sob o CHECK | ❌ | ver `PermutaExecucaoRepository.test.ts:42` + `0054_permuta_execucao_parcial.sql` |
| Asserções monetárias que passam por `round2()` do serviço (uso legítimo de `toBe(<literal>)`) | 21 sítios em `ReconciliacaoPermutaService.test.ts` — **todas** contra saídas já normalizadas por `round2` (`bxaMnyValor`, `bxaMnyJuros`, `bxaMnyLiquido`); o card `testability-8` (6 sítios pré-existentes fora de `round2`) **NÃO** é reaberto por este delta | `toBe` só sobre saídas de `round2`; `toBeCloseTo` para intermediários float | ✅ | grep `.toBe([0-9]` + leitura de `ReconciliacaoPermutaService.ts:48` (`round2`) |
| Tamanho de `ReconciliacaoPermutaService.test.ts` | **1.301 LOC** (era ~570) — 4 `describe` de topo, 46 `it()` | < 800 LOC por arquivo de teste, ou split por invariante | ⚠️ | `wc -l` |
| `.test.ts` no worktree | 123 suites backend · 27 suites frontend (baseline em `main` era 122/26) | manter razão ≥ 1 arquivo de teste por serviço tocado | ✅ | `_shared-metrics.md` |
| Cobertura por diretório do módulo | 94,74 % stmts / 72,78 % branch (do run anterior, não re-medida) | ≥ 80 %/70 % em `service/permutas`, `repository/permutas` | ✅ | run `2026-09-08-1414-permutas` |
| Determinismo: clock em `routes/permutas.ts` | `new Date()` em `permutas.ts:128, 134, 603` e `todayUtcMidnightMs()` em `508, 582`; card `testability-2` do run anterior segue aberto — este delta **não** introduziu `ClockProvider` | ClockProvider injetável | ⚠️ | grep `new Date\|Date.now` |
| Determinismo: `Math.random`/UUID no delta | 0 sítios em código de produção do delta | 0 | ✅ | grep |

> ⚠️ **Não medível localmente**: cobertura de branch por arquivo neste run (`--quick`). Custo declarado em `_shared-metrics.md`.
> ⚠️ **Não medível localmente**: teste de integração contra Postgres real da migration 0054. Não existe suíte `docker-compose.test.yml` no repo; a instrumentação está em aberto desde `testability-9` do run anterior.

## 3. Tactics — Cobertura no nf-projects

Bass ch.10 — nomes canônicos em inglês.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** (test hooks) | Serviço aceita `dataMovto: number` como parâmetro, o que dá ao teste um clock injetável **na fronteira do serviço** (todas as chamadas `service.reconciliar({...dataMovto: 1})` no teste). Falta o mesmo tratamento à camada de rota, que ainda computa `todayUtcMidnightMs()` internamente. | ⚠️ parcial | `ReconciliacaoPermutaService.ts:67`, `routes/permutas.ts:508` |
| **Recordable Test Cases** (fixtures gravadas do ERP) | Ausente no delta: os mocks devolvem literais inline (`bxaMnyValor: 40879.9`) capturados de HARs de sonda, mas não persistidos como fixtures nomeadas. A alternativa (fixtures JSON versionadas) existe em `sispag/__fixtures__/` mas não foi replicada para `permutas`. | ❌ ausente | `ReconciliacaoPermutaService.test.ts:31-57` (literais inline); contraste em `src/backend/domain/interface/sispag/__fixtures__/` |
| **Sandbox** (controlled environment) | O mock do advisory lock com `Set<number>` em `ReconciliacaoPermutaService.test.ts:83-100` é uma sandbox do lock: um mundo controlado que simula chaves em voo. Value ok, limitação em §4/F-1. | ✅ presente | `ReconciliacaoPermutaService.test.ts:83-100` |
| **Executable Assertions** (invariantes assertados como código) | `beginExecution: linha já settled ⇒ alreadySettled` e `PRESERVA parcial (não regride)` — os terminais são invariantes do repositório, e o teste os assertta com `.toEqual({status, alreadySettled})` diretamente. O SQL da CASE é também assertado literal (`sql.match(/IN \('settled', 'parcial'\)/g).toHaveLength(5)` — 5 CASEs devem usar o MESMO predicado terminal). | ✅ presente | `PermutaExecucaoRepository.test.ts:44-48` |
| **Abstract Data Sources** | O serviço injeta `alocacaoRepository`, `execucaoRepository`, `relationalRepository`, `conexosBaixaClient`, `conexosTitulosClient`, `db` via `@inject` — todos mockados por construtor em `buildDeps()`. Zero acesso a banco/rede nos testes. | ✅ presente | `ReconciliacaoPermutaService.test.ts:112-125` |
| **Limit Structural Complexity** | O serviço vive em 1.093 LOC (era ~800). O teste cresceu para 1.301 LOC. A separação em 4 `describe` no arquivo de teste segue o Bass ("group by aspect under test"), mas o próprio serviço concentra I-Recon-5/6/7 + I-Write-6/7/8a/8b em um único arquivo — o teste é grande porque o serviço é. | ⚠️ parcial | `ReconciliacaoPermutaService.ts:1093 LOC`, `ReconciliacaoPermutaService.test.ts:1301 LOC` |
| **Limit Non-Determinism** | `dataMovto` injetado (bom); `Math.imul(31, h) | 0` na `chaveDeLock` é puro (bom). Mas `routes/permutas.ts` ainda lê `new Date()` diretamente (não deste delta; herdado). | ⚠️ parcial | `ReconciliacaoPermutaService.ts:175-181` (bom) vs `routes/permutas.ts:128,134,603` (aberto — carrega `testability-2`) |

## 4. Findings (achados)

### F-testability-1: O teste de concorrência prova o CONTRATO, não a semântica do Postgres

- **Severidade**: P2
- **Tactic violada**: Sandbox (o mock é uma sandbox HONESTA do contrato, mas não do sistema real que executa em produção)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts:83-100` (mock) + `src/backend/domain/client/database/PostgreeDatabaseClient.ts:137-158` (implementação real)
- **Evidência (objetiva)**:
  ```typescript
  // .test.ts:83-100 — o "lock" é um Set em memória, no processo do teste
  const chavesEmVoo = new Set<number>();
  withAdvisoryLock: jest.fn(async (lockKey, onAcquired, onBusy) => {
      if (chavesEmVoo.has(lockKey)) return onBusy();
      chavesEmVoo.add(lockKey);
      try { return await onAcquired(); } finally { chavesEmVoo.delete(lockKey); }
  })
  // PostgreeDatabaseClient.ts:145-158 — o real usa pg_try_advisory_lock por CLIENT do pool
  const client = await this.connectionPool.connect();
  const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
  ```
  O mock **re-implementa** a semântica do lock: um teste que passa contra este mock também passaria se o código de produção usasse um `Set` no lugar do `pg_try_advisory_lock`. O que o teste **de fato prova** é que o serviço (a) chama `db.withAdvisoryLock`, (b) com uma chave estável derivada do `adiantamentoDocCod`, (c) chama `onBusy` quando ocupada, (d) chama `onAcquired` quando livre. Se o dev remover a chamada, o teste falha (dois `gravarBaixaPermuta` em `Promise.allSettled`). Se o dev trocar `pg_try_advisory_lock` por outra API de lock que respeite o mesmo contrato, o teste **não** falha — o que pode ser certo (o contrato é o que importa) OU errado (uma migração acidental para lock ROW-level, ou para um lock que não sobrevive ao pooler).
- **Impacto técnico**: o Render roda ≥2 instâncias do backend contra o mesmo Postgres. `pg_try_advisory_lock` é session-scoped no cliente que o adquiriu — o serviço mantém o mesmo `PoolClient` durante `onAcquired` (`.ts:145-155`). Duas instâncias competindo pelo mesmo `adiantamentoDocCod`: só a serialização real, no Postgres, prova que uma vê `locked=true` e a outra `false`. Nenhum teste neste worktree faz isso.
- **Impacto de negócio**: **super-pagamento** é o defeito que R-1 P0 combate — duas baixas de R$ 38 mil no mesmo par escapariam se o lock só existisse no papel. `PostgreeDatabaseClient.test.ts:164-201` prova a semântica **DENTRO** de um único cliente do pool (mocka `pool.connect().query()`); não prova a serialização cross-connection.
- **Métrica de baseline**: 4 testes de concorrência **contra mock** neste delta (`ReconciliacaoPermutaService.test.ts:784/824/848/874`); **0** testes de concorrência contra Postgres real. O run anterior aponta `testability-9` (integração contra PG real) como aberto.

### F-testability-2: Migration `0054_permuta_execucao_parcial.sql` sem teste que exercite o CHECK em runtime

- **Severidade**: P1
- **Tactic violada**: Executable Assertions (o invariante `status ∈ {pending, reconciling, settled, error, parcial}` só é verificado no TEXTO do SQL do repositório, nunca no banco)
- **Localização**: `src/backend/migrations/0054_permuta_execucao_parcial.sql:18-23` + `src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts:42-48`
- **Evidência (objetiva)**:
  ```typescript
  // PermutaExecucaoRepository.test.ts:42-48 — LITERAL SQL, não semântica
  expect(sql).toContain("permuta_alocacao_execucao.status IN ('settled', 'parcial')");
  expect(sql.match(/permuta_alocacao_execucao\.status IN \('settled', 'parcial'\)/g)).toHaveLength(5);
  ```
  ```sql
  -- 0054_permuta_execucao_parcial.sql:18-23
  ALTER TABLE permuta_alocacao_execucao
      DROP CONSTRAINT IF EXISTS permuta_alocacao_execucao_status_check;
  ALTER TABLE permuta_alocacao_execucao
      ADD CONSTRAINT permuta_alocacao_execucao_status_check
          CHECK (status IN ('pending', 'reconciling', 'settled', 'error', 'parcial'));
  ```
  A migration comenta explicitamente: **"o CHECK antigo rejeita o INSERT em RUNTIME (não no deploy), e a falha apareceria DEPOIS de baixas já POSTadas no ERP"**. Ou seja: se por qualquer motivo (typo no nome da constraint em uma migration futura, migration não aplicada no ambiente, rollback parcial) o CHECK antigo permanecer, o primeiro `INSERT ... status='parcial'` **falha em produção**, e neste momento a linha do handshake fin010 já foi POSTada, o dinheiro já se moveu, e a trilha não conseguirá gravar o terminal correto.
- **Impacto técnico**: falha detectada apenas em produção, num ponto onde o rollback é caro (o borderô + baixa fin010 existem no ERP; a única forma de reagir é `markError` e reconciliação manual).
- **Impacto de negócio**: reintrodução do `settled` mudo que ADR-0043 mata — mas em silêncio, mascarado por um erro genérico de INSERT. O ledger diverge do ERP em uma linha que é, por definição, o registro mais sensível do módulo.
- **Métrica de baseline**: **0 testes** exercitam a migration 0054 contra Postgres real. `testability-9` do run anterior (integração contra PG) segue aberto e este delta não o remedia — pelo contrário, adiciona **uma migration a mais** que depende dela.

### F-testability-3: Guarda de paridade FE↔BE cobre 3 de 7 uniões e o regex quebra com formatação

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (a paridade é um invariante; a guarda que a defende é fragilizada por regex)
- **Localização**: `src/frontend/lib/types.test.ts:23-39` + `src/frontend/lib/types.ts:25,39,91,262,296,352,369,396`
- **Evidência (objetiva)**:
  ```typescript
  // types.test.ts:26 — o regex depende de:
  //   1. `export type <Nome> =` seguido por `... ;` (semicolons obrigatório)
  //   2. Não haver `;` em nenhum comentário/JSDoc dentro da união
  const match = source.match(new RegExp(`export type ${typeName}\\s*=([^;]+);`))
  // types.test.ts:36 — regex do frontend depende de `\n\n` (linha em branco) como sentinela
  const match = source.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?)\\n\\n`))
  ```
  **Vetores de quebra da guarda (não do produto)**:
  - Alguém remove o `;` no fim da união do backend (TS permite) → regex do backend falha, teste vermelho **sem defeito real**.
  - Formatador insere JSDoc `/** ... ; ... */` no meio da união → regex captura fragmento → asserção compara literais errados.
  - Formatador colapsa a linha em branco após uma união no frontend → regex do FE consome literais da união seguinte.
  **Cobertura**: `frontend/lib/types.ts` declara **8** `export type` de string-union (`StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`, `ExecucaoStatus`, `LoteAdiantamentoStatus`, `PermutaStatusBordero`, `BorderoSituacao`, `RelatorioTipo`). O teste cobre **3**. As não-cobertas (`StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`, `BorderoSituacao`, `RelatorioTipo`) espelham enums vivos do backend (`ontology/glossary.md` e `_index.json`), e um deles muda em toda `/feature-tweak` de gestão/elegibilidade.
- **Impacto técnico**: uma união muda no backend, o frontend não é atualizado, o typecheck de cada projeto passa (os dois compilam separadamente), o comportamento diverge em produção — que é exatamente o defeito C-6 que este teste existe para prevenir. A guarda cobre um subconjunto e cede a formatação inocente.
- **Impacto de negócio**: recorrência do defeito C-6 (badge que cai no `else` errado; status que a UI não sabe desenhar). O run anterior cita como P0 do delta a divergência de tipo detectada por review humana; se a guarda não fizer isso, a próxima passa sem detecção.
- **Métrica de baseline**: 3/8 uniões cobertas (37,5 %); 0 asserções sobre paridade estrutural (só o conjunto de literais, não o nome do tipo declarado).

### F-testability-4: Ramo `pago===1` dentro da tolerância de `assertCobertura` sem asserção "no-warn"

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:693-708` + `ReconciliacaoPermutaService.test.ts:947-971`
- **Evidência (objetiva)**:
  ```typescript
  // ReconciliacaoPermutaService.ts:693
  if (t.pago === 1 && Math.abs(abertoUsd) > TOLERANCIA_FECHAMENTO_NEG) {
      await this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, ... });
  }
  ```
  O teste `'\`pago === 1\` divergindo do aberto derivado vira BUSINESS_WARN — nunca recusa'` (linha 947) prova a **PRESENÇA** do WARN quando o aberto derivado é ≠ 0. Não existe teste que asserta a **AUSÊNCIA** do WARN no caso `pago===1` com aberto ≈ 0 (título quitado sem ruído de arredondamento). O silêncio do log neste ramo faz parte do contrato — "sem divergência, não ruja".
- **Impacto técnico**: um dev que "simplifica" o predicado para `if (t.pago === 1)` (sem o `Math.abs > TOLERANCIA`) faz o WARN vazar para todo título quitado. O teste **atual passa**, porque o caso quitado não é asserido. O log fica poluído; o detector proativo que aponta invariante-broken via BUSINESS_WARN passa a gritar em toda baixa.
- **Impacto de negócio**: ruído no canal de log, e degradação do sinal do detector proativo — que já é o cão de guarda de I-Recon-7. Não é P0/P1: é higiene.
- **Métrica de baseline**: 6 dos 7 ramos observáveis de `assertCobertura` são exercitados; 1 (não-warn na tolerância) não é.

### F-testability-5: `ReconciliacaoPermutaService.test.ts` cruzou 1.300 LOC — o teste ficou o dobro do serviço

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts` (1.301 LOC)
- **Evidência (objetiva)**: 4 `describe` de topo (main, serialização I-Recon-5, cobertura I-Write-8a, terminal parcial I-Recon-6/7, borderoAindaValido T2), 46 `it()`. O arquivo é indexável por `describe`, e cada grupo carrega um docblock referenciando o invariante. Mas o `buildDeps` é compartilhado, o que acopla os 46 casos ao mesmo constructor de mocks — mudar a assinatura do serviço (`+1` `@inject`) força reformatação de 46 cases via `as never`.
- **Impacto técnico**: futuras mudanças no serviço têm alto custo de merge; um `describe` novo agora tem custo estrutural crescente. Ainda dentro do aceitável (razão teste/serviço 1.301/1.093 ≈ 1,2), mas o arquivo passa a ser um **hotspot** de conflitos em `/feature-tweak` paralelas.
- **Impacto de negócio**: fricção em manutenção; nenhum defeito de produto derivável.
- **Métrica de baseline**: 1.301 LOC / 46 `it()` = 28 LOC/case (razoável). Comparação: `sispag/RemessaService.test.ts` tem 906 LOC. Threshold subjetivo Bass ~800 LOC.

### F-testability-6: Clock seam do card `testability-2` continua aberto (contexto do run anterior)

- **Severidade**: P2 (herdado; **não** é finding deste delta, é continuação declarada)
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/routes/permutas.ts:128,134,508,582,603`, `src/backend/domain/service/permutas/AgingService.ts:17`, `src/backend/domain/service/permutas/EleicaoPermutasService.ts:367,374,417`, `src/backend/domain/service/permutas/PainelService.ts:60`, `src/backend/domain/service/permutas/IngestaoPermutasService.ts:73,89`
- **Evidência (objetiva)**: `grep -n "new Date\|Date.now" ...` retorna 10 sítios em produção do módulo permutas fora do delta. O contexto de `_shared-metrics.md` diz "`dataMovto` causou 7 das 12 falhas de produção" — a raiz da fragilidade permanece. O delta **cede** o parâmetro `dataMovto` como injectable **no serviço**, mas a rota ainda calcula `todayUtcMidnightMs()` internamente.
- **Impacto técnico**: um teste E2E de `dataMovto` (do request HTTP até o payload fin010) não é reproduzível sem congelar o clock ou passar `dataMovto` explícito — o teste da rota faz o segundo, o que atende hoje mas mantém a fragilidade quando o dev omite o campo.
- **Impacto de negócio**: recorrência do erro de data de movimento na baixa quando alguém adiciona um caller que não passa `dataMovto`.
- **Métrica de baseline**: 10 sítios `new Date()`/`Date.now()` no módulo permutas (fora do delta); 0 `ClockProvider` injetável no bootstrap.

### F-testability-7: `GerarSolicitacaoNumerarioService` — 880 LOC morto ainda pesa no baseline (contexto do run anterior)

- **Severidade**: P3 (herdado; segue aberto, não fecha neste delta)
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/permutas/GerarSolicitacaoNumerarioService.ts` (650 LOC) + `.test.ts` (230 LOC)
- **Evidência (objetiva)**: `wc -l` retorna 880 LOC totais para o par serviço+teste. ADR-0029 sinalizou o serviço como morto; o run `testability-3` pediu remoção; este delta não toca. `grep gerarNumerario` mostra 4 sítios (2 no serviço, 2 no teste próprio), sem consumidor externo. Continua no baseline como imposto de testes.
- **Impacto técnico**: cada `--coverage` do módulo permutas paga o custo destes 880 LOC no denominador; cada refactor que toca o namespace `service/permutas` paga o custo de re-ler o arquivo morto para descartar.
- **Impacto de negócio**: nenhum defeito direto; imposto contínuo no ciclo de review.
- **Métrica de baseline**: 880 LOC mortos permanecem; `testability-3` do run anterior é a origem, e ele não foi implementado.

## 5. Cards Kanban

### [testability-baixa-1] Suíte de integração contra Postgres real cobrindo advisory lock + CHECK da migration 0054

- **Problema**
  > Duas remediações P0/P1 deste delta dependem de comportamento do Postgres que o teste unitário **não pode** provar: (a) `pg_try_advisory_lock` serializando duas conexões DIFERENTES do pool (o mock com `Set<number>` prova o contrato, não a semântica cross-connection); (b) o CHECK constraint da migration 0054 aceitando `INSERT status='parcial'` — hoje só o TEXTO do SQL do repositório é assertado (`PermutaExecucaoRepository.test.ts:42`). Enquanto essa suíte não existir, uma migration mal-aplicada, um typo no nome da constraint, ou uma migração acidental do lock para uma API que não sobrevive ao pooler passam batido — e a detecção acontece **em produção**, depois do POST fin010 já ter movido dinheiro. Referências: `PostgreeDatabaseClient.ts:137-158`, `0054_permuta_execucao_parcial.sql:18-23`, `ReconciliacaoPermutaService.test.ts:83-100`.

- **Melhoria Proposta**
  > Introduzir suíte com marcador `describe('integration: ...', ...)` conforme padrão do CLAUDE.md, contra Postgres em contêiner (docker-compose.test.yml minimo). Casos: (1) duas conexões concorrentes pedindo `pg_try_advisory_lock($1)` — a segunda recebe `locked=false`; (2) migration 0054 aplicada, `INSERT ... status='parcial'` **succeeds**; (3) constraint antigo (pré-0054) rejeita `'parcial'` com CHECK violation; (4) SESSION-level lock não vaza para outra sessão do pool após `release()`. Tactic Bass: **Sandbox** (banco descartável) + **Executable Assertions** (invariante do CHECK verificado no banco, não no texto do SQL).

- **Resultado Esperado**
  > Testes de integração contra Postgres real do módulo permutas: **0 → ≥4 cases**. Confiança contra dupla-baixa cross-instance: **derivada** (mocked) → **medida**. Migration 0054 verificada em CI antes do deploy.

- **Tactic alvo**: Sandbox, Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: L (1–2 sem — precisa de docker-compose.test.yml, scripts de migração no CI, wiring do jest para o marcador `integration:`)
- **Findings relacionados**: F-testability-1, F-testability-2
- **Métricas de sucesso**:
  - Testes de integração contra PG real no módulo permutas: 0 → ≥4 cases
  - Confiança da guarda R-1 P0 (dupla-baixa): "prova o contrato" → "prova o comportamento cross-connection"
  - Migration 0054 gates em CI: 0 → 1 (aplica + testa antes de release)
- **Risco de não fazer**: uma migration não-idempotente ou renomeada em `0055+` pode deixar o CHECK antigo de pé; o primeiro `parcial` em produção falha DEPOIS do fin010 aceitar a baixa; o erro chega ao analista como "falha ao gravar terminal" e o ledger diverge. Custo estimado: 1 super-pagamento por incidente do padrão do borderô 15593 = ~R$ 5–40k por par afetado.
- **Dependências**: escolha entre `pg-mem` (rápido, sem docker) e Postgres real em contêiner (fidelidade total). Recomendação: Postgres real — `pg-mem` não implementa `pg_advisory_lock` fielmente. Coordenar com `Deployability` para o CI runner.

### [testability-baixa-2] Ampliar guarda de paridade FE↔BE — cobrir 7/7 uniões, matar o regex

- **Problema**
  > O teste `frontend/lib/types.test.ts` cobre **3 de 8** uniões espelhadas à mão (`ExecucaoStatus`, `PermutaStatusBordero`, `LoteAdiantamentoStatus`), e usa `readFileSync + match(new RegExp(...=([^;]+);))` — o que quebra em três cenários inocentes: (a) remoção do `;` (TS aceita), (b) `;` dentro de comentário/JSDoc na união, (c) colapso da `\n\n` sentinela do FE. As não-cobertas (`StatusElegibilidade`, `TipoPermuta`, `ProcessamentoStatus`, `BorderoSituacao`, `RelatorioTipo`) espelham enums que mudam a cada `/feature-tweak` de gestão. A guarda existe para prevenir o defeito C-6 (badge divergente sem typecheck failure) — cobrir menos da metade das uniões é ceder metade da defesa.

- **Melhoria Proposta**
  > Duas frentes: (1) **acabar com o regex** — extrair as uniões do backend para um módulo `src/backend/domain/interface/permutas/enums.ts` exportado como valor (`export const EXECUCAO_STATUS = ['pending','reconciling','settled','error','parcial'] as const` + `type ExecucaoStatus = typeof EXECUCAO_STATUS[number]`), e importar o valor no teste FE via caminho relativo — a comparação passa a ser `expect(FRONTEND_EXECUCAO_STATUS).toEqual(BACKEND_EXECUCAO_STATUS)`, sem parsing de texto; (2) **cobrir 7/7 uniões** — parametrizar via `describe.each`. Tactic Bass: **Executable Assertions** (invariante = "as duas listas são iguais", assertado no CÓDIGO, não no TEXTO do código).

- **Resultado Esperado**
  > Uniões espelhadas cobertas: **3/8 → 8/8**. Fragilidade do regex: **presente → ausente** (compilador falha se o valor exportado do backend não bate). Custo de acrescentar uma nova união: **manter 4 lugares → manter 2 lugares (o valor e o teste `describe.each`)**.

- **Tactic alvo**: Executable Assertions, Abstract Data Sources
- **Severidade**: P2
- **Esforço estimado**: M (2–3d — a extração dos `as const` é mecânica, mas cada consumidor no backend do union type precisa migrar para o valor exportado; se o backend usa `import type` no lugar de `import`, mudar não muda runtime)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Uniões cobertas pela paridade: 3 → 8
  - Fragilidade da guarda (quebra com formatação inocente): 3 vetores → 0
  - LOC de regex-parsing em `types.test.ts`: ~20 → 0
- **Risco de não fazer**: reincidência do C-6 (badge que cai no `else` errado) em qualquer união fora das 3 cobertas. Detectável hoje só por revisão humana ou incidente.
- **Dependências**: nenhuma; escopo contido em `src/backend/domain/interface/permutas/` + `src/frontend/lib/types*.ts`.

### [testability-baixa-3] Ramos residuais de `assertCobertura` — asserção explícita de "no-warn" na tolerância

- **Problema**
  > `ReconciliacaoPermutaService.ts:693` tem o predicado `if (t.pago === 1 && Math.abs(abertoUsd) > TOLERANCIA_FECHAMENTO_NEG)`. O teste `ReconciliacaoPermutaService.test.ts:947` prova o WARN quando o aberto derivado ≠ 0. Não existe teste que asserta a **AUSÊNCIA** do WARN no caso `pago===1` com aberto ≈ 0 (o caso normal de título quitado). Se alguém remover o `&& Math.abs(...) > TOLERANCIA` (por "simplificação"), o WARN passa a vazar em toda baixa; o teste atual **não pega**. Além disso, o guard `bxaCodSeqs[0] !== undefined ? {…} : {}` no `markParcial` (`.ts:582`) tem um ramo vazio que nenhum teste exercita — hoje inalcançável (parcial implica ≥1 baixa gravada), mas é um ramo pago no CI.

- **Melhoria Proposta**
  > (1) `it('pago===1 dentro da tolerância NÃO emite WARN — silêncio é contrato')` — cobertura 500 quitada com `Math.abs(abertoUsd) < 0.005`, assertar `logService.warn` NÃO chamado com `pago`; (2) documentar (no docblock ou como `throw` explícito) que o ramo "`bxaCodSeqs` vazio em `parcial`" é inalcançável — ou remover a guarda condicional se de fato é. Tactic Bass: **Executable Assertions** (ausência é tão importante quanto presença).

- **Resultado Esperado**
  > Ramos observáveis de `assertCobertura` cobertos: **6/7 → 7/7**. Guardas mortas no laço de resíduo: **1 → 0** (removida ou documentada como unreachable). Sinal do detector proativo BUSINESS_WARN protegido contra "otimização" que quebre o silêncio.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Ramos cobertos de `assertCobertura`: 6/7 → 7/7
  - Asserções "no-warn" no arquivo: 0 → ≥1
- **Risco de não fazer**: poluição do canal BUSINESS_WARN por regressão silenciosa; degradação do detector proativo I-Recon-7. Baixo impacto financeiro direto, alto impacto no signal-to-noise.
- **Dependências**: nenhuma.

### [testability-baixa-4] Split de `ReconciliacaoPermutaService.test.ts` por invariante ou índice `describe`

- **Problema**
  > `ReconciliacaoPermutaService.test.ts` cruzou **1.301 LOC / 46 it()** neste delta. Os 4 `describe` de topo (I-Recon-5, I-Write-8a, I-Recon-6/7, T2) são coesos, mas compartilham `buildDeps()` — o que acopla os 46 casos à mesma assinatura de construtor do serviço. O ciclo do `painel-operacao` já mostrou o pedágio: adicionar 1 `@inject` custa 46 edições `as never` neste arquivo. É o único arquivo do módulo que cruzou o threshold de 1k LOC.

- **Melhoria Proposta**
  > (1) Extrair `buildDeps` para um `__testkit__/reconciliacaoPermutaServiceKit.ts` — muda de "46 casos com deps posicional" para "46 casos com deps NOMEADA e defaults" (`buildService({ chavesEmVoo: new Set() })`); (2) split opcional por invariante: `.i-recon-5-concorrencia.test.ts`, `.i-write-8a-cobertura.test.ts`, `.i-recon-6-7-parcial.test.ts`. Tactic Bass: **Limit Structural Complexity**. Não é remoção — é reorganização por eixo de invariante (mesmo padrão usado hoje pelos `describe`, elevado ao filesystem).

- **Resultado Esperado**
  > LOC do maior arquivo de teste do módulo: **1.301 → ≤ 500 por arquivo**. Custo de "adicionar 1 `@inject` ao serviço": **46 edições `as never`** → **1 edição no kit**. Diferença de compreensão para novo dev: `describe` de topo em 1 arquivo → 4 arquivos nomeados por invariante — o índice fica no filesystem.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: M (2–3d — mecânico, mas roda em todo `it()`)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - LOC do maior test file no módulo permutas: 1.301 → ≤ 500
  - Sítios `as never` no `buildDeps`: 12 → 0 (com kit tipado)
- **Risco de não fazer**: hotspot de conflito de merge crescente. Toda `/feature-tweak` paralela que toque o serviço colide neste arquivo.
- **Dependências**: coordenar com futuros deltas que já estejam em worktree paralelo (evitar rebase caro).

## 6. Notas do agente

- **Não abri card para F-testability-6 (clock seam) e F-testability-7 (código morto do GerarSolicitacaoNumerarioService)**: os dois são achados HERDADOS do run anterior — `testability-2` e `testability-3` — e continuam válidos como registrados. Duplicá-los aqui polui o Kanban; o `qa-consolidator` deve mesclar por `Findings relacionados` com o run pai. Escopo restrito ao DELTA é intencional; os findings aparecem em §4 para deixar a continuidade explícita, não para pedir ação nova.
- **`testability-8` (uso de `toBe` em valores monetários) NÃO é reaberto por este delta**: os 21 `toBe(<literal>)` novos em `ReconciliacaoPermutaService.test.ts` são todos contra saídas já normalizadas por `round2` (`ReconciliacaoPermutaService.ts:48`). `round2` é determinístico por definição; comparar com literal aqui é correto. Os 6 sítios pré-existentes do run anterior seguem em aberto.
- **`testability-4` (borderoAindaValido 5/5 ramos) é FECHADO por este delta**: `ReconciliacaoPermutaService.test.ts:1241-1300` cobre `borCod undefined`, `getBordero → null`, `borCodEstornado preenchido`, `borVldFinalizado === 2`, e `getBordero rejeita`. Sinalizar ao `qa-consolidator` para marcar como resolvido.
- **Cross-QA**: F-1/F-2 (integração PG) toca `Fault Tolerance` (o CHECK e o lock defendem invariantes contra super-pagamento) e `Deployability` (gate de migration em CI). F-3 (paridade) toca `Modifiability` (compartilhar tipos entre FE/BE = reduzir custo de mudança). F-6 (clock) toca `Modifiability` — o `ClockProvider` é a mesma solução. F-7 (código morto) toca `Modifiability`.
- **Score 8**: os testes que existem provam o essencial (concorrência via mock com semântica honesta, `parcial` no happy path, contrato de erro HTTP, badge B1' com 4 renders). O que falta é o TESTE de integração contra Postgres real — F-1 e F-2 têm a mesma solução, e é uma peça arquitetural. Ausência dela vale −2 no score; não subo mais porque a fragilidade da guarda FE↔BE também é real.
