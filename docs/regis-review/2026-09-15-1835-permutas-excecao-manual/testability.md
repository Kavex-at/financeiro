---
qa: Testability
qa_slug: testability
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-testability
generated_at: 2026-09-15T18:55:00Z
scope: backend+frontend
score: 7.8
findings_count: 6
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Kavex introduz a exceção manual "permutado fora do painel" (ADR-0047) — nova classe de decisão humana que atravessa 5 camadas: migration 0059 (tabela + CHECKs + índice parcial + extensão da guarda da 0055) → repositório novo `ExcecaoPermutaRepository` → serviço novo `ExcecaoPermutaService` (2 responsabilidades: pós-passe puro em `computeCandidatas` **e** marcar/desfazer transacional com efeito imediato) → hook em `EleicaoPermutasService.computeCandidatas` (pós-fan-out, pré-`contarPorEstado`) → 2 rotas admin (`POST`/`DELETE`) + payload `/permutas/gestao` + 4 colunas do export Excel → UI (2 dialogs, hook `useExcecaoManual`, tag, badge, botões na `VisaoGeralTable`) | Delta da branch `fix/permutas-excecao-manual`: 20 arquivos de código (~1.3k SLOC) + 12 arquivos de teste (~1.8k SLOC), 1 migration nova (0059) + duas CHECKs redefinidas por nome (0055 estendida), 0 script de reverse (política justificada em A4). Nenhuma lógica monetária nova (só reclassificação sobre valores já lidos) | Dev local: Jest + ts-jest com mocks de `PostgreeDatabaseClient`; Frontend com Jest + Testing Library + hook wrappers do RTL. **Ainda sem harness Postgres real** no domínio permutas (14 `*.integration.test.ts` em `routes/recebimentos.*`, **0** em `*/permutas/**`). Migração 0059 aplicada 3× num Postgres 16 descartável local à mão (jamais no Supabase). Deploy em Render/Vercel. Ground truth ao vivo: **N/A por natureza** (classificação sobre dados já-lidos — sem fórmula monetária nova). | O engenheiro consegue provar por teste unitário todos os 11 cenários canônicos da entrevista (8721 aplicado; 5 estados que devem cair 422; ERP muda → computed wins + `BUSINESS_WARN`; ERP `valorPermutado>0` → `ja-permutado` vence; undo restaura só o motivo da exceção; race duplicada → 409 via `23505`; autor do JWT com body `criadoPor` ignorado; Histórico exclui exceção sem borderô), 400/401/403/404/409/422 no HTTP, e que a justificativa NÃO vaza para o log. | 11/11 casos canônicos pinados em `describe`/`it` com asserção direta; ≥1 asserção que prova exclusão do texto da justificativa do log (`JSON.stringify(entrada)).not.toContain(JUSTIFICATIVA)`); 100% dos testes do delta usam constructor injection (0 `container.resolve` no serviço/repositório novos); RBAC estendida em `permutas.test.ts:796-806` com as 2 rotas novas; suíte agregada +7 suítes / +122 testes em backend (128/~1890 → 137/2012) e +9 testes em frontend (352 → 361) — todos verdes. |

Contra-caso concreto tratado por este ciclo: o 8721 foi permutado por baixas manuais 21↔198 em 30/04, o Conexos não preencheu `mnyTitPermuta`, e a eleição o classificava como `bloqueada / sem-saldo-permutar` (enganoso, mas conforme a ADR-0046). A ADR-0047 abre exatamente **um** slot de decisão humana com guarda (só `BLOQUEADA / sem-saldo-permutar`), trilha (autor+justificativa+data, soft delete) e "o cálculo vence quando o dado muda no ERP". A regra dessa testabilidade é: (a) o predicado da guarda é **um** só, importado por 3 caminhos (`aplicarExcecoes`, `marcar`, `guardaSatisfeita`); (b) todos os predicados de estado usam `ESTADO_ELEGIBILIDADE.*` e `MOTIVO_BLOQUEIO.*` no serviço (constantes), embora os testes de rota/repositório usem string crua a propósito para validar o wire; (c) o pós-passe garante que a exceção só é lida no fim do `computeCandidatas`, e o teste `listAtivas` é chamado 1× por run (`EleicaoPermutasService.test.ts:457`) prova a ausência de N+1.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por camada — arquivos `.test.ts(x)` tocados vs sources tocados no delta** (interface, repository, service, routes, frontend) | Interface (`ExcecaoPermuta.ts`, `EstadoElegibilidade.ts`, `Gestao.ts`): **0/3** (0%; são só tipos + docblock, aceitável) · Repository (`ExcecaoPermutaRepository`, `PermutaRelationalRepository.reclassificarAdiantamento`): **2/2 (100%)** · Service (`ExcecaoPermutaService`, `EleicaoPermutasService` pós-passe, `GestaoPermutasService.exporGestao`, `RelatorioExportService.defAdiantamentos`): **4/4 (100%)** · Routes (`permutas.ts` POST/DELETE excecao-manual): **1/1 (100%)** · Frontend (`format.ts`, `ui.tsx`, `useExcecaoManual.ts`, `ExcecaoManualDialog.tsx`, `DesfazerExcecaoDialog.tsx`, `VisaoGeralTable.tsx`, `page.tsx` (35 LOC), `api.ts`, `types.ts`, `textarea.tsx`, `historico.ts` exclusão): **7/11 (64%)** — `page.tsx`, `types.ts`, `textarea.tsx` sem teste dedicado, mas o `useExcecaoManual` (hook) e o `api.ts` (via `excecao-manual-api.test.ts`) cobrem os pontos vivos | ≥ 0.5 por camada com código de produção; interface-só-tipo dispensável | ✅ para o delta (backend 100%, frontend 64% mas com pontos mortos como `types.ts`/`textarea.tsx`) | `_shared-metrics.md` §Delta · `git diff --stat origin/main..HEAD -- '**/*.test.*'` · `wc -l` por arquivo |
| Testes novos no delta (contagem `it`/`test`) | `ExcecaoPermutaService.test.ts` (novo, 490 LOC): **18** it/it.each · `ExcecaoPermutaRepository.test.ts` (novo, 155 LOC): **6** · `permutas.test.ts` (+187 LOC, novo `describe('exceção manual …')` c/ ~8 casos + 2 novas linhas em RBAC list): **8** · `EleicaoPermutasService.test.ts` (+208 LOC, novo `describe('exceção manual (ADR-0047)')`): **5** · `GestaoPermutasService.test.ts` (+126 LOC, `describe('exceção manual "permutado fora do painel"')`): **4** · `RelatorioExportService.test.ts` (+94 LOC, `describe('RelatorioExportService — exceção manual (ADR-0047)')`): **4** · `PermutaRelationalRepository.test.ts` (+43 LOC): **2** (`reclassificarAdiantamento` OK + 0-linhas) · Frontend: `permutas-components.test.tsx` (+210 LOC, 3 blocos: `exceção manual — badge e tag`, `ExcecaoManualDialog`, `DesfazerExcecaoDialog`, `VisaoGeralTable — exceção manual`): **~10** · `excecao-manual-api.test.ts` (novo, 89 LOC): **5** · `excecao.test.ts` (novo, 78 LOC): **6** · `historico.test.ts` (+29 LOC, novo `describe('montarHistorico — exceção manual (ADR-0047)')`): **1** · `useExcecaoManual.test.tsx` (novo, 83 LOC): **4** = **73 testes novos** no delta | ≥ 30 para um delta de 20 arquivos de código que muda 5 camadas | ✅ | `grep -cE '^\s+it\(\|^\s+it\.each' <arquivo>` |
| Suíte agregada backend | **137 suítes / 2012 testes** (baseline 128/~1890 → +7 suítes / +122 testes) | +N > 0, gate verde | ✅ | `_shared-metrics.md` §Gate results |
| Suíte agregada frontend | **43 suítes / 361 testes** (+3 suítes / +9 testes vs baseline anterior) | +N > 0 | ✅ | `_shared-metrics.md` |
| **Casos canônicos da entrevista pinados em unit test** (11 cenários) | 11/11: **(1) 8721 aplicado** — `ExcecaoPermutaService.test.ts:84-103` + `EleicaoPermutasService.test.ts:383-396` (totais `totalJaPermutado=1`, `totalBloqueadas=0`) · **(2) 422 para todo outro estado/motivo** — `ExcecaoPermutaService.test.ts:304-331` `it.each` sobre 5 tuplas: `bloqueada/nao-pago`, `bloqueada/data-base-indisponivel`, `elegivel/undefined`, `permuta-manual/cliente-filtro`, `ja-permutado/ja-permutado` (`erro.statusCode === 422`, `db.withTransaction` não chamado) · **(3) ERP muda: `valorPermutar=5000` → computed vence + `BUSINESS_WARN` pt-BR** — `ExcecaoPermutaService.test.ts:118-136` + `EleicaoPermutasService.test.ts:409-434` (asserção `warn.mock.calls.filter(docCod==='8721').length === 1`, `LOG_TYPE.BUSINESS_WARN`, mensagem `/Exceção manual de permuta não aplicada/`, `data.flowId` presente) · **(4) ERP `valorPermutado>0` → `ja-permutado` (motivo do ERP vence)** — `ExcecaoPermutaService.test.ts:138-156` · **(5) `detail-indisponivel` → transiente** — `:158-176` + `EleicaoPermutasService.test.ts:436-455` (`aviso.message.match(/transitóri/)`, `data.transiente=true`) · **(6) Undo restaura só se motivo é `permutado-fora-do-painel`** — `ExcecaoPermutaService.test.ts:440-475` (`de: {ja-permutado, permutado-fora-do-painel}, para: {bloqueada, sem-saldo-permutar}`) + `:468-475` (exceção inativa: 0 reclassificadas não é erro) · **(7) HTTP 400/401/403/404/409/422** — `permutas.test.ts:635-654` (400 via 5 justificativas inválidas em `it.each`), `:780-788` (401 sem auth), `:791-843` (403 role não-admin, lista `mutacoes` estendida com as 2 rotas), `:714-744` (422/404/409 do serviço → contract `{error: code, message: userMessage}`) · **(8) Autor do JWT, body `criadoPor` ignorado** — `permutas.test.ts:656-676` (body `criadoPor: 'forjado'` → serviço recebe `'user-abc'` do token; justificativa passa por trim) + `:678-693` (fallback `email` quando `sub` ausente) + `:695-712` (sem `sub` nem `email` → 401, nunca `'unknown'`) · **(9) Race duplicate → 409 via `23505`** — `ExcecaoPermutaService.test.ts:382-396` (`Object.assign(new Error(...), { code: '23505' })` no `insertAtiva` → `EXCECAO_JA_ATIVA`) + `:366-380` (409 preventivo por `findAtiva`) + `:398-409` (erro genérico de banco NÃO vira 409) · **(10) `listAtivas` 1× por compute (sem N+1)** — `EleicaoPermutasService.test.ts:457-486` (2 filiais, 2 adtos) · **(11) Histórico exclui exceção manual (sem borderô do painel)** — `historico.test.ts:275-301` (`itens.some((h) => h.adtoDocCod === '8721')` deve ser `false`) | 11/11 pinados com asserção específica | ✅ | Vistoria linha-a-linha dos 12 arquivos do delta |
| **Log secret hygiene** — a justificativa **não** vaza para o log | ✅ `ExcecaoPermutaService.test.ts:301` faz `expect(JSON.stringify(entrada)).not.toContain(JUSTIFICATIVA)` explicitamente; o serviço (`ExcecaoPermutaService.ts:158-163, 189-193`) só envia `{ docCod, criadoPor }` / `{ docCod, removidoPor }` no `data` do `info` | 0 vazamento; asserção de negativa presente | ✅ Ganho concreto de auditabilidade | `ExcecaoPermutaService.test.ts:301, 462-465` |
| **Migration 0059 automatizada em CI** (tabela + CHECKs + índice parcial + extensão da guarda 0055) | ❌ **Aplicada à mão 3× em Postgres 16 descartável** (`_shared-metrics.md`), zero teste automatizado. `rollbacks.test.ts:44-46` fixa a lista exata de reverses em `['0054', '0055']` — **não** existe verificação de que a 0059 é idempotente sob CI, nem asserção de que `CHECK (NOT (estado='bloqueada' AND motivo IN ('ja-permutado','permutado-fora-do-painel')))` está de fato ativa e não `NOT VALID`. Padrão pré-existente do repo: nenhuma `*.integration.test.ts` em domínio permutas | ≥1 teste que aplique a migration num Postgres real (docker-compose.test.yml ou testcontainer) e prove: idempotência, o índice parcial barra 2ª exceção ativa, a CHECK barra `bloqueada + permutado-fora-do-painel` | ❌ Gap real, MAS pré-existente (delta segue o padrão do repo) — vide F-testability-1 | `find src/backend -name '*.integration.test.ts' -path '*permuta*'` vazio; `find src -name 'docker-compose*'` vazio |
| **SQL do `reclassificarAdiantamento` (novo, com `WHERE deEstado = $deEstado AND deMotivo = $deMotivo`) contra Postgres real** | ❌ 0 testes de integração; asserção existe só via string exata (`PermutaRelationalRepository.test.ts:405-419`, `normalizado = 'UPDATE permuta_adiantamento SET estado_elegibilidade = $paraEstado ...'`). O comportamento de "reclassificação concorrente devolve 0 → erro dentro da tx, insert da exceção rollbacked" é testado só por mock (`ExcecaoPermutaService.test.ts:411-436`, `mockResolvedValue(0)`) | ≥1 teste em pg real que prove: (a) sem `NOT stale` no `WHERE`, uma linha `stale=true` seria reclassificada errada (regressão que a string-match não pega); (b) a CHECK 0055 estendida efetivamente bloqueia o insert quando o motivo colapsado escapa | ⚠️ Compartilha o gap com F-testability-1 | `PermutaRelationalRepository.test.ts:405-419` |
| **DI seam usado nos testes do delta** (constructor injection vs `container.resolve`) | ✅ 100% do serviço e do repositório usam `new ExcecaoPermutaService(...)` / `new ExcecaoPermutaRepository(db)` (`ExcecaoPermutaService.test.ts:22-28, 257`; `ExcecaoPermutaRepository.test.ts:42, 64, 88, 99, 125, 149`). O `EleicaoPermutasService.test.ts` injeta o `ExcecaoPermutaService` **REAL** com o repo mockado (`:86-92`: "Serviço REAL da regra de aplicação (pura) — só as dependências de escrita são fingidas") — integração de serviços em unidade. `permutas.test.ts` usa `container.registerInstance` intencionalmente porque o wire do handler é o SUT, não a lógica | 100% construtor no serviço/repositório; 0 container | ✅ | `grep -n 'container.resolve\|new .*Service\|new .*Repository'` |
| **Determinismo temporal do delta** (`new Date()`/`Date.now()` em código NOVO) | ✅ Código novo não lê o relógio no serviço/repositório: `criado_em` e `removido_em` vêm do `DEFAULT now()` e `now()` do próprio Postgres (`0059_excecao_permuta.sql:46, 77`). Único uso do relógio no delta é 2 chamadas pré-existentes em `permutas.ts` (`:129, 695` — `now = new Date()`) não introduzidas por este ciclo. Ordem de execução: nenhum `beforeAll`/`afterAll` compartilha estado entre `it`s | 0 `new Date()`/`Date.now()` no código novo do serviço/repo | ✅ | `grep -n 'new Date()\|Date.now' <arquivos novos>` = 0 |
| **CI executa `npm test -- --coverage`** e piso enforçado | ✅ `.github/workflows/ci.yml:27, 46` roda `npm test -- --coverage` em backend e frontend (gates bloqueadores). Piso `jest.config.cjs:39-48`: **global** 72/54/78%, **`./domain/service/`** 88%/60% — o novo `ExcecaoPermutaService.ts` cai nesse balde, com 18 testes puros + I/O que devem manter o piso | Gate presente; piso ratchet | ✅ | `.github/workflows/ci.yml:27, 46` · `src/backend/jest.config.cjs:39-48` · `src/frontend/jest.config.js:40-49` |
| **Cobertura Jest do delta** (`--coverage`) | ⚠️ **Não coletada** (modo `--quick`); baseline global backend 72/54/78%; frontend 33/23/28% (ratchet reassentado em 2026-09-03). Delta adiciona ~300 LOC de serviço puro que deve subir a cobertura de `./domain/service/` marginalmente | Manter ≥ 88% lines / 60% branches em `domain/service/` | ⚠️ Não medível no run `--quick` | `src/backend/jest.config.cjs:39-48` |
| **Tamanho do maior arquivo de teste tocado no delta** | `EleicaoPermutasService.test.ts` = **1538 LOC** (delta +208, pré-existente); `permutas.test.ts` = **1190 LOC** (delta +187, pré-existente); `GestaoPermutasService.test.ts` = ~1078 LOC (delta +126, pré-existente); `ExcecaoPermutaService.test.ts` = **490 LOC** (delta INTEIRO — novo, no limite da heurística Bass ≤500) | ≤ 500 LOC por arquivo de teste (heurística Bass) | ⚠️ Pré-existente; delta perpetua agregando ~500 LOC em 3 arquivos-monstro | `wc -l src/backend/**/*.test.ts` |
| **RBAC list em `permutas.test.ts:796-806` (lista hard-coded de mutações)** | ⚠️ Delta adiciona 2 entradas em `mutacoes` para as 2 rotas novas (`POST /permutas/adiantamentos/A1/excecao-manual`, `DELETE ...`). A verificação depende do dev **lembrar** de atualizar a lista — se a próxima rota de mutação esquecer, o RBAC segue falso-verde | Teste deveria enumerar rotas do `Router` via introspecção, não lista mão-a-mão | ⚠️ Padrão pré-existente; delta perpetua sem agravar | `permutas.test.ts:796-806` |
| **Hook `useExcecaoManual` — cobertura de estados** | ✅ 4/4 caminhos: sucesso ao marcar + `load()` + `toast.success` (`:29-42`); recusa 422/409/404 mantém modal aberto + `toast.warning` (`:44-57`); sucesso ao desfazer (`:59-70`); erro genérico ao desfazer (`:72-82`). **Sem** caso explícito de 409-por-corrida separado do 422 (`ExcecaoManualRecusadaError` vira `toast.warning` em qualquer código) | Cobertura de estados observáveis do hook | ✅ (com nota: race não tem asserção separada) | `useExcecaoManual.test.tsx:29-82` |
| **Property-based testing (`fast-check`) sobre a guarda** | ❌ 0 uso de `fast-check` no backend. Guarda tem espaço de entrada finito e discreto (~50 combinações), então `it.each` já cobre satisfatoriamente | Opcional | ✅ N/A justificada | `grep -rn fast-check src/backend` vazio |

> ⚠️ **Não medível localmente**: cobertura `--coverage` completa (modo `--quick`). O CI (`.github/workflows/ci.yml:27, 46`) roda com `--coverage` e o `coverageThreshold` já é enforçador; a probabilidade de regressão silenciosa está mitigada pelo próprio gate.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | ✅ `ExcecaoPermutaService` isola **regra pura** (`aplicarExcecoes`, `guardaSatisfeita`) de **I/O transacional** (`marcar`, `desfazer`) num mesmo objeto — o pós-passe da eleição usa só a parte pura e o `ExcecaoPermutaService.test.ts` §"guardaSatisfeita" e §"aplicarExcecoes" (`:60-194`) exercitam sem tocar em banco. `ExcecaoPermutaRepository` expõe `listAtivas`/`findAtiva`/`insertAtiva`/`softDeleteAtiva` como 4 métodos discretos, cada um testado. `reclassificarAdiantamento(tx, {docCod, de, para})` no `PermutaRelationalRepository` **recebe o estado de origem no `WHERE`** — a assinatura torna a corrida explícita e testável. | ✅ | `ExcecaoPermutaService.ts:72-107` (puro) vs `:117-194` (I/O) · `PermutaRelationalRepository.ts:621` |
| Record/Playback (Recordable Test Cases) | ⚠️ Não há fixture gravado do Conexos para o detalhe do 8721 (o adto que motiva a ADR). `EleicaoPermutasService.test.ts:335-486` monta o wire à mão (`{ valorPermutar: 0, valorAberto: 0.02 }`, `listFiliais`, `listAdiantamentosProforma`). Padrão do repo: sem `__fixtures__/*.json` para permutas. Um payload gravado do 8721 seria contrato-de-mudança grátis contra o wire do Conexos. | ⚠️ | `find src/backend/domain -name "__fixtures__" -path "*permuta*"` vazio |
| Sandbox | ⚠️ Único sandbox real do delta é o mock in-memory do `PostgreeDatabaseClient`; a migration 0059 (5 objetos DDL — 1 tabela, 3 CHECKs, 1 índice parcial + 2 CHECKs redefinidas) é aplicada à mão em pg descartável (`_shared-metrics.md`). Zero `*.integration.test.ts` em permutas — 14 existem em `routes/recebimentos.*`, provando que a capacidade existe no repo, só não foi propagada. O índice parcial `uq_permuta_excecao_manual_ativa` (semântica `WHERE removido_em IS NULL` do Postgres) e as CHECKs redefinidas por nome (0055 estendida) ficam sem cobertura de banco real. | ⚠️ Pré-existente | `find src/backend -name '*.integration.test.ts' -path '*permuta*'` vazio |
| Executable Assertions | ✅ (a) O código do serviço lança `ExcecaoPermutaRecusadaError` com `code` discriminado (`EXCECAO_GUARDA_RECUSADA`/`ADIANTAMENTO_NAO_ENCONTRADO`/`EXCECAO_JA_ATIVA`/`EXCECAO_NAO_ENCONTRADA`), cada `code` testado (`ExcecaoPermutaService.test.ts:266-267, 326-327, 361-362, 377-378, 484-485`); (b) `reclassificarAdiantamento` retorna `rowCount` e o serviço lança erro se for 0 (`ExcecaoPermutaService.ts:146-148`), evitando exceção órfã sem reclassificação; (c) `isUniqueViolation` (`:196-200`) traduz `23505` do índice parcial em 409 — teste dedicado `:382-396`; (d) o teste `expect(JSON.stringify(entrada)).not.toContain(JUSTIFICATIVA)` (`:301`) é asserção negativa executável contra vazamento de segredo. | ✅ | Vistoriado |
| Abstract Data Sources | ✅ Todas as dependências entram por `@inject` (tsyringe): `ExcecaoPermutaService` recebe `PostgreeDatabaseClient`, `PermutaRelationalRepository`, `ExcecaoPermutaRepository`, `LogService`. Nenhum `container.resolve` no serviço/repositório. `withTransaction` recebe callback com `TransactionClient` — o teste mocka a `tx` e passa por `db.withTransaction as jest.Mock` (`:225-228`). Clock não é abstraído mas o delta não lê o relógio — a materialização temporal é do Postgres (`DEFAULT now()`). | ✅ (para o delta) | `ExcecaoPermutaService.ts:59-66` · `ExcecaoPermutaRepository.ts:20-25` |
| Limit Structural Complexity | ✅ `ExcecaoPermutaService.ts` = 201 LOC com **um** predicado de guarda (`guardaSatisfeita`, `:72-73`) reusado 3× (pós-passe, `marcar`, derivação de `excecaoManual.ativa` no `GestaoPermutasService`). O pós-passe adiciona 49 LOC ao `EleicaoPermutasService` (`:396-402`) — pontual, sem ramificar `processFilial`/`buildCandidata`. ⚠️ `EleicaoPermutasService.test.ts` = **1538 LOC** e `permutas.test.ts` = **1190 LOC** — arquivos-monstro pré-existentes que o delta engrossa em ~200 LOC cada. | ⚠️ delta OK; testes gigantes pré-existentes | `wc -l` · `ExcecaoPermutaService.ts:72-73` (única definição da guarda) |
| Limit Non-Determinism | ✅ **para o delta**: código novo não lê `Date.now()`/`new Date()`. Timestamps do banco vêm do `now()` do próprio Postgres. Testes não usam `beforeAll`/`afterAll` para partilhar estado (`beforeEach` só para `jest.clearAllMocks()` e `container.clearInstances()`). ⚠️ **Pré-existente:** ~8 chamadas `new Date()`/`Date.now()` em `IngestaoPermutasService`/`EleicaoPermutasService` **não** injetadas por `ClockProvider` — o delta atual não agrava. | ✅ delta / ⚠️ pré-existente | `grep -n 'new Date()' <arquivos novos>` = 0 |

## 4. Findings (achados)

### F-testability-1: Migration 0059 (tabela + 2 CHECKs redefinidas + índice parcial + guarda 0055 estendida) só validada por `psql -f` 3× à mão; 0 teste automatizado

- **Severidade**: P2
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql:41-101`; `src/backend/migrations/rollbacks.test.ts:44-46` (lista de reverses fixa em `['0054', '0055']`)
- **Evidência (objetiva)**:
  ```
  find src/backend -name '*.integration.test.ts' -path '*permuta*'  → vazio
  find src -name 'docker-compose*'                                  → vazio
  _shared-metrics.md §Gate results: "Migration 0059 aplicada 3× (idempotente)
    em Postgres 16 local descartável; nunca aplicada no Supabase compartilhado"
  ```
  A 0059 tem 3 propriedades que dependem da semântica do Postgres e não são exercitadas em CI: (a) idempotência sob `CREATE TABLE IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` + `ALTER TABLE ... VALIDATE CONSTRAINT`; (b) o índice parcial `uq_permuta_excecao_manual_ativa ON permuta_excecao_manual (adiantamento_doc_cod) WHERE removido_em IS NULL` (linhas 66-68) tem que barrar duas ativas para o mesmo `adiantamento_doc_cod`, permitindo remarcar depois do soft delete — nenhum teste prova essas duas propriedades; (c) as duas CHECKs redefinidas por nome (`permuta_adiantamento_sem_estado_colapsado`, `permuta_candidata_snapshot_sem_status_colapsado`) agora incluem `permutado-fora-do-painel` no conjunto proibido, redefinidas com `ADD ... NOT VALID` seguido de `VALIDATE CONSTRAINT` — se algum dado histórico já violar, a segunda instrução falha, mas isso só se detecta rodando contra dados reais.
- **Impacto técnico**: um refactor futuro que troque `WHERE removido_em IS NULL` do índice parcial por `WHERE removido_em IS NOT NULL` (inversão de sinal) passa no CI. O código produz `ERRO: duplicate key value violates unique constraint` só em prod na primeira 2ª exceção ativa.
- **Impacto de negócio**: baixo hoje (a 0059 já foi aplicada num pg descartável 3× sem erro). Médio quando um analista tentar remarcar depois de desfazer e o índice parcial estiver quebrado: 409 em prod, sem repro local possível sem tocar o Supabase.
- **Métrica de baseline**: 0 testes de integração cobrindo a 0059 (idempotência, índice parcial, CHECKs estendidas); 14 integrações existem em `routes/recebimentos.*`. `rollbacks.test.ts:44-46` fixa a lista em `['0054', '0055']`, sem entrada para a 0059 (justificado no ADR — política de reverse é para UPDATE > 1.000 linhas).

### F-testability-2: `reclassificarAdiantamento` (novo, com `WHERE deEstado/deMotivo` + `NOT stale`) validado só por casamento de string; concorrência testada só por mock

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (asserção codificada no schema não é exercitada em runtime)
- **Localização**: `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:621` (implementação nova); `src/backend/domain/repository/permutas/PermutaRelationalRepository.test.ts:393-434` (testes)
- **Evidência (objetiva)**: o teste `reclassificarAdiantamento: UPDATE parametrizado com o estado de ORIGEM no WHERE, na tx` (`:393-420`) faz uma asserção de string exata (`:409-411`): `'UPDATE permuta_adiantamento SET estado_elegibilidade = $paraEstado, motivo_bloqueio = $paraMotivo WHERE doc_cod = $docCod AND NOT stale AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo'`. O teste seguinte (`:422-434`) prova que `rowCount=0` é devolvido quando a linha não está no estado de origem — MAS o `rowCount=0` é forçado por `(tx.update as jest.Mock).mockResolvedValue(0)`, não pelo Postgres avaliando o `WHERE`. Nenhum teste comportamental exercita: (a) `NOT stale` filtrando de verdade uma linha `stale=true`; (b) o comportamento em pg real quando 2 transações concorrentes tentam reclassificar a mesma linha (uma pega o lock, a outra vê rowCount=0). O rollback dentro da tx (`ExcecaoPermutaService.test.ts:411-436`) também é forçado por `mockResolvedValue(0)`.
- **Impacto técnico**: se alguém remover `AND NOT stale` do `WHERE`, o teste de string cai vermelho — mas a "correção" instintiva é atualizar a string esperada. A propriedade comportamental (linha stale NÃO deve ser reclassificada por marcar/desfazer) só reaparece quando um adto que sumiu do backlog aparece marcado no painel.
- **Impacto de negócio**: cenário concreto — um adto foi ingerido, depois virou stale (não veio mais do Conexos por 1 semana), e o analista marca a exceção via API antes da próxima ingestão. Sem o `NOT stale`, a linha stale é reclassificada e a próxima ingestão sobrescreve. Sem teste comportamental, essa regressão silenciosamente atravessa PR.
- **Métrica de baseline**: 1 asserção de string exata; 2 mocks de `rowCount`; 0 testes com Postgres real onde `NOT stale` seja efetivamente exercido.

### F-testability-3: RBAC das novas rotas depende de lista hard-coded em `permutas.test.ts:796-806`

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (a asserção depende do dev lembrar de estender a lista)
- **Localização**: `src/backend/routes/permutas.test.ts:791-843` (bloco `RBAC — requireRole nas rotas de mutação`); o `it` central itera sobre `const mutacoes: Array<[string, string]>` **fixo** (`:796-806`) — o delta adicionou 2 entradas (`POST/DELETE /permutas/adiantamentos/A1/excecao-manual`) manualmente
- **Evidência (objetiva)**: `permutas.test.ts:796-806` lista as 9 mutações à mão. O comentário no arquivo (`:815-819`) já reconhece que a lista produziu falso-verde no passado (a sonda antiga em `GET /painel` estourava 500 e o `not.toBe(403)` passava por acidente). Se um analista amanhã adicionar `POST /permutas/borderos/:borCod/reprocessar` e esquecer da lista, o teste RBAC segue verde. O delta fez o certo (estende a lista) MAS não introduz salvaguarda contra a próxima rota.
- **Impacto técnico**: uma rota nova sem `requireRole('admin')` continuaria aberta a `authenticated` sem que o RBAC test falhe. Como o backend não expõe `requireRole` de forma introspectável (é uma chamada dentro do handler), a única solução prática é introspecção do `Router` ou anotação declarativa.
- **Impacto de negócio**: baixo hoje (o delta lembrou de atualizar); médio como precedente — a lista já foi fonte de defeito e o padrão persiste.
- **Métrica de baseline**: 9 rotas listadas à mão; 0 asserções sobre "toda rota mutation-verbo do Router está na lista".

### F-testability-4: `useExcecaoManual` não distingue toast de 409 (corrida) vs 422 (guarda) em teste — depende só do texto do backend

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/permutas/components/useExcecaoManual.test.tsx:44-57`; `useExcecaoManual.ts` (o `toast.warning(erro.message)` no teste sugere flow único para toda `ExcecaoManualRecusadaError`)
- **Evidência (objetiva)**: o teste 2 do hook (`:44-57`) usa **um** `ExcecaoManualRecusadaError('Só "Sem saldo a permutar".')` para representar toda a família 422/409/404 do backend. `toast.warning` é chamado com a `message` bruta do backend. Não há caso separado (a) `409 EXCECAO_JA_ATIVA` (dois analistas abrem o modal ao mesmo tempo) para verificar que o texto pt-BR distingue corrida. O hook fica dependente da mensagem do backend estar correta e diferente por código — nenhuma asserção prova isso.
- **Impacto técnico**: se o backend mudar `userMessage` do 409 para o mesmo texto do 422 (regressão de UX), o hook não detecta — o teste passa igual porque só afirma `toast.warning(<qualquer mensagem>)`. Como o backend expõe `code` no `body.error` (`permutas.test.ts:714-744`), o hook poderia usar o `code` (não a `message`) para desambiguar UX.
- **Impacto de negócio**: baixo direto (a UX cai um degrau, não quebra). Médio como precedente — a diferença 409-vs-422 é a razão de existir dos dois `code`s.
- **Métrica de baseline**: 1 teste cobrindo toda a família recusada; 0 testes por `code` individual do hook.

### F-testability-5: `RelatorioExportService.soData` (`iso.slice(0, 10)`) sem teste com data ISO próxima da virada UTC

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (space of inputs)
- **Localização**: `src/backend/domain/service/permutas/RelatorioExportService.ts:442` (`private soData = (iso?: string): string | null => (iso ? iso.slice(0, 10) : null)`); `RelatorioExportService.test.ts:307` (asserção `excecaoData: '2026-09-15'` para `criadoEm: '2026-09-15T14:30:00.000Z'`)
- **Evidência (objetiva)**: `soData` faz `slice(0, 10)` sobre a string ISO — o que é correto para preservar o dia UTC. MAS o teste só valida esse caso, sem antipode: se algum dia alguém trocar a implementação por `new Date(iso).toLocaleDateString('pt-BR')` (a "correção" instintiva quando alguém reclamar do formato), o valor exibido varia por fuso da máquina — em prod (Render, UTC) daria dia 15, em dev (São Paulo, UTC-3) daria dia 15 se hora >= 03:00, mas dia 14 se hora < 03:00. Não há teste `expect(soData('2026-09-15T02:30:00.000Z')).toBe('2026-09-15')` provando timezone-independência.
- **Impacto técnico**: baixo hoje (a implementação usa `slice`). Médio como armadilha para refactor.
- **Impacto de negócio**: baixo — cenário raro (analista marca exceção às 23h no cliente, aparece com data de amanhã no relatório).
- **Métrica de baseline**: 1 caso de dia (14:30 UTC) testado; 0 casos próximos da virada UTC.

### F-testability-6: Testes de tamanho — `EleicaoPermutasService.test.ts` 1538 LOC, `permutas.test.ts` 1190 LOC, novo `ExcecaoPermutaService.test.ts` já em 490

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` (1538 LOC, delta +208 = 15,6%); `src/backend/routes/permutas.test.ts` (1190 LOC, delta +187 = 18,6%); `src/backend/domain/service/permutas/GestaoPermutasService.test.ts` (~1078 LOC, delta +126); `src/backend/domain/service/permutas/ExcecaoPermutaService.test.ts` (novo, 490 LOC — no limite)
- **Evidência (objetiva)**: 3 arquivos de teste pré-existentes já eram "arquivos-monstro"; o delta engrossa cada um em ~200 LOC. Bass: > 500 LOC = sinal de que o unit-under-test cresceu demais. Aqui é o oposto: os arquivos crescem porque **acumulam** `describe`s ao longo dos deltas (`describe('exceção manual (ADR-0047)')` sequencial). O novo `ExcecaoPermutaService.test.ts` (490 LOC) já flerta com o teto — o próximo delta que evoluir a exceção (ex.: notificação, expiração, exportação de trilha) empurra pra 700+.
- **Impacto técnico**: encontrar um `it` específico via `describe` aninhado exige `grep`; refactor do serviço obriga ler 1500 linhas para saber quais casos são afetados.
- **Impacto de negócio**: baixo direto; médio como custo de manutenção crescente.
- **Métrica de baseline**: 3 arquivos ≥ 1000 LOC pré-existentes; 1 arquivo novo (490) no limite; 4 arquivos crescem ~500 LOC no delta.

## 5. Cards Kanban

### [testability-1] Cobrir a migration 0059 (tabela + índice parcial + CHECKs 0055 estendidas) com teste automatizado contra Postgres real

- **Problema**
  > As 3 propriedades da migration 0059 mais dependentes da semântica do Postgres — (a) idempotência sob `CREATE TABLE IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS` + `VALIDATE CONSTRAINT`; (b) o índice parcial `uq_permuta_excecao_manual_ativa ... WHERE removido_em IS NULL` barrar duas exceções ativas para o mesmo `adiantamento_doc_cod` **e permitir remarcar depois do soft delete**; (c) a CHECK `permuta_adiantamento_sem_estado_colapsado` estendida (`NOT (estado='bloqueada' AND motivo IN ('ja-permutado','permutado-fora-do-painel'))`) barrar de fato o insert em `permuta_adiantamento` — são hoje validadas só por `psql -f` **manual** 3× num Postgres 16 descartável (`_shared-metrics.md` §Gate results). Zero cobertura em CI. O padrão de integração existe no repo (14 `*.integration.test.ts` em `routes/recebimentos.*`), mas não foi propagado para permutas.

- **Melhoria Proposta**
  > Criar `src/backend/migrations/0059_excecao_permuta.integration.test.ts` seguindo o padrão de `routes/recebimentos.*.integration.test.ts`. Cobrir 5 cenários: (a) rodar a 0059 duas vezes seguidas sem erro (idempotência); (b) inserir uma exceção ativa e tentar inserir a segunda para o mesmo `adiantamento_doc_cod` → erro `23505`; (c) soft-deletar a primeira e provar que a segunda insere; (d) tentar inserir `INSERT INTO permuta_adiantamento (estado='bloqueada', motivo='permutado-fora-do-painel')` → erro da CHECK; (e) o mesmo para `permuta_candidata_snapshot`. Tactic Bass: Sandbox + Executable Assertions. Reaproveitar o `docker-compose` que hoje suporta os `recebimentos.*.integration.test.ts` — se não existir dedicado, propor um `docker-compose.test.yml` mínimo.

- **Resultado Esperado**
  > `find src/backend -name '*.integration.test.ts' -path '*permuta*'` sobe de 0 → **≥1** (primeiro teste de integração no domínio permutas). 5 semânticas do Postgres pinadas em CI. Refactor futuro que quebre o índice parcial ou as CHECKs cai vermelho no PR, não em prod.

- **Tactic alvo**: Sandbox
- **Severidade**: P2
- **Esforço estimado**: M (2-5d — reuso do harness `recebimentos.*.integration.test.ts` puxa para 2d; scaffold novo, 5d)
- **Findings relacionados**: F-testability-1, F-testability-2
- **Métricas de sucesso**:
  - Testes de integração no domínio permutas: **0 → ≥5** (idempotência, índice parcial, remarcar-após-soft-delete, CHECK adto, CHECK snapshot)
  - Semânticas do Postgres exercitadas sob PR: **0 → 5**
- **Risco de não fazer**: um refactor que troque `WHERE removido_em IS NULL` do índice parcial por `WHERE removido_em IS NOT NULL` (inversão de sinal — o defeito canônico F-testability-3 da run anterior) atravessa CI e só quebra na primeira 2ª exceção ativa em prod. Não há ground-truth ao vivo aqui (é classificação, não dinheiro) — nenhum gate residual do Regis-Review pega.
- **Dependências**: Levantar (ou reaproveitar) o `docker-compose.test.yml` que `routes/recebimentos.*.integration.test.ts` já pressupõe. Cross-QA: sobrepõe **Fault Tolerance** (CHECK 0055 estendida = defesa em profundidade contra estado colapsado) e **Deployability** (gate de CI antes de deploy).

### [testability-2] Auto-descobrir rotas de mutação no RBAC test em `permutas.test.ts` para eliminar a lista hard-coded

- **Problema**
  > `permutas.test.ts:796-806` mantém uma lista fixa `mutacoes: Array<[method, path]>` com 9 rotas. O delta adicionou 2 entradas para as rotas novas de exceção manual. O comentário no próprio arquivo (`:815-819`) reconhece que a lista já produziu falso-verde no passado (a sonda antiga em `GET /painel` estourava 500 e o `not.toBe(403)` passava por acidente). Uma rota de mutação nova que esqueça de estender a lista escapa o gate — o RBAC segue passando enquanto a rota fica aberta a `authenticated`.

- **Melhoria Proposta**
  > Substituir a lista hard-coded por introspecção do `permutasRouter` (Express expõe `router.stack.filter(l => l.route).map(l => ({method, path}))`), filtrar por `method !== 'get'`, e iterar. Alternativa: anotação declarativa nas rotas (comentário `// @requiresRole:admin`) e um teste que faz `grep` na fonte. Tactic Bass: Executable Assertions — a asserção de "toda rota de mutação exige admin" fica derivada, não escrita à mão.

- **Resultado Esperado**
  > O RBAC test se auto-atualiza quando o router muda: adicionar uma rota `POST` nova sem `requireRole('admin')` cai vermelho. Métrica: lista de rotas fonte-única (do router, não do teste): **hard-coded → derivada**. Cobertura de rotas de mutação: **9 fixas → N do router**.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Lista de mutações hard-coded no teste: **9 linhas → 0**
  - Novas rotas de mutação sem admin detectadas antes do PR: **manual (memória do dev) → automático**
- **Risco de não fazer**: o precedente registrado nas próprias linhas 815-819 se repete. Uma rota nova de mutação sem `requireRole` passa o CI e é descoberta em prod por um usuário `authenticated` conseguindo mutar. Cross-QA: sobrepõe **Security** (autorização) e **Modifiability** (adicionar rota deveria ser 1 passo, hoje são 2).
- **Dependências**: nenhum.

### [testability-3] Distinguir 409 (`EXCECAO_JA_ATIVA`) de 422 (`EXCECAO_GUARDA_RECUSADA`) no hook `useExcecaoManual` com teste por `code`

- **Problema**
  > `useExcecaoManual.test.tsx:44-57` testa a família 422/409/404 num único caso — o `ExcecaoManualRecusadaError` é jogado com uma mensagem qualquer e o teste só assere `toast.warning(<mensagem>)`. O backend expõe `body.error === 'EXCECAO_JA_ATIVA'` (corrida entre 2 analistas) vs `body.error === 'EXCECAO_GUARDA_RECUSADA'` (estado mudou no ERP entre abrir e confirmar o modal) — dois caminhos com UX diferente (corrida pede "outra pessoa marcou; recarregue"; guarda recusada pede "o estado do adto mudou; revise"). Hoje o hook depende só do `message` do backend, e o teste não trava mudança acidental de UX.

- **Melhoria Proposta**
  > (1) Se `useExcecaoManual` ainda não usa `error.code`, refatorar para consumir o `code` do `ExcecaoManualRecusadaError` e ramificar o toast (`toast.warning('Outra sessão marcou; recarregando…')` + `load()` em 409; `toast.warning(erro.message)` em 422; `toast.error()` em 500). (2) Adicionar em `useExcecaoManual.test.tsx` 2 casos separados: (a) 409 → toast específico + `load()` chamado; (b) 422 → toast com a mensagem pt-BR + `load()` NÃO chamado. Tactic Bass: Executable Assertions (asserção por `code`, não por texto).

- **Resultado Esperado**
  > UX distinta por família de erro, com contrato pinado. Cobertura do hook: **1 teste para toda a família recusada → 3 testes por `code`** (409/422/404). Uma mudança de UX que colapse os 3 casos cai vermelho.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Testes do hook por `code`: **1 → 3**
  - `code` do erro consumido pelo hook: **não → sim** (via `ExcecaoManualRecusadaError.code`, se ainda não existir)
- **Risco de não fazer**: baixo direto; médio como precedente (a razão de existir dos dois `code`s se dilui na cara do analista).
- **Dependências**: verificar/expor `code` no `ExcecaoManualRecusadaError` do frontend (`lib/api.ts`).

### [testability-4] Extrair casos do `ExcecaoPermutaService.test.ts` novo em ≥2 arquivos por sub-responsabilidade (puro vs I/O) antes que passe de 500 LOC

- **Problema**
  > `ExcecaoPermutaService.test.ts` já tem 490 LOC no delta inaugural — no limite da heurística Bass de 500 LOC. O arquivo tem 3 responsabilidades: `guardaSatisfeita`, `aplicarExcecoes` (regra pura, 8 casos) e `marcar/desfazer` (transacional, ~10 casos). O próximo delta que evoluir a exceção (ex.: notificação a auditor, expiração automática, exportação de trilha) empurra o arquivo para o mesmo caminho que `EleicaoPermutasService.test.ts` (1538 LOC) e `permutas.test.ts` (1190 LOC) — arquivos-monstro onde `grep` vira a única forma de navegar.

- **Melhoria Proposta**
  > Dividir `ExcecaoPermutaService.test.ts` em 2 arquivos: (a) `ExcecaoPermutaService.aplicarExcecoes.test.ts` (guarda + pós-passe puro, ~200 LOC); (b) `ExcecaoPermutaService.marcar-desfazer.test.ts` (transacional, ~300 LOC). Tactic Bass: Limit Structural Complexity. Precedente no repo: `SaldoAlocacaoAdiantamentoService.test.ts` já separa "puro" de "I/O" dentro do mesmo arquivo (ADR-0046).

- **Resultado Esperado**
  > Nenhum arquivo de teste do domínio exceção-manual passa de 300 LOC. Métrica: `wc -l src/backend/**/Excecao*.test.ts` **1 arquivo × 490 → 2 arquivos × ≤300**. Custo de encontrar um caso específico cai de "1 grep no arquivo gigante" para "1 escolha entre 2 nomes".

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - LOC do maior arquivo de teste da exceção manual: **490 → ≤300**
  - Arquivos ≥ 500 LOC no domínio permutas: **3 pré-existentes; delta pode ficar em 3, não 4**
- **Risco de não fazer**: baixo hoje; o padrão do repo mostra que arquivos-monstro só crescem, nunca encolhem sem esforço explícito. Cross-QA: sobrepõe **Modifiability** (custo de tocar o arquivo cresce com o LOC).
- **Dependências**: nenhum.

## 6. Notas do agente

- **Decisões de escopo**: rodei `--quick` (sem `--coverage`), então rastreabilidade fina de cobertura de linhas por arquivo do delta não foi coletada; o CI (`.github/workflows/ci.yml:27, 46`) roda `--coverage` e o `coverageThreshold` já é enforçador (backend 72/54/78 global, 88/60 em `domain/service/`; frontend 33/23/28 ratchet). **Não re-levantei** achados pré-existentes já cobertos em `2026-09-15-0207/testability.md` (integração pg-real ausente em permutas; `page.tsx` sem teste; `EleicaoPermutasService.test.ts` 1500+ LOC; `ClockProvider` ausente) — o delta atual **não introduz nem agrava** essas dívidas de forma nova, exceto o crescimento marginal em LOC que virou F-testability-6.
- **Cross-QA detectadas**: (a) F-testability-1/F-testability-2 sobrepõem-se a **Fault Tolerance** (CHECK 0055 estendida é defesa em profundidade contra estado colapsado) e a **Deployability** (falta gate de CI que rode a migration em pg real); (b) F-testability-3 sobrepõe-se a **Security** (autorização) e **Modifiability** (adicionar rota deveria ser 1 passo); (c) F-testability-4 sobrepõe-se a **Integrability** (o `code` do erro é o contrato entre backend e frontend); (d) F-testability-6 sobrepõe-se a **Modifiability** (custo de manutenção dos arquivos-monstro).
- **Métricas que tentei e falhei**: cobertura de branches por arquivo do delta (`--quick`); tempo de execução da suíte agregada com o delta (não medido — o gate registrou "verde", não "duração").
- **Observação positiva**: **este é um delta testability-net-positivo, sem P0/P1**. Os 11 cenários canônicos da entrevista estão pinados 1-a-1; o predicado da guarda é único (`guardaSatisfeita`) e reusado 3×; o log secret hygiene tem asserção negativa executável (`.not.toContain(JUSTIFICATIVA)`) — coisa rara e cara de acertar; o pós-passe puro `aplicarExcecoes` é testado sem tocar em banco; o `EleicaoPermutasService.test.ts` injeta o serviço REAL de exceção com o repo mockado; 100% do serviço/repositório novos usam construtor injection; o histórico exclui a exceção sem borderô com teste próprio; a race `23505` do índice parcial vira 409 com teste dedicado. Ground truth é N/A por natureza (classificação sobre dados já-lidos), e o gate documentou a justificativa no PR. Os 4 cards são melhorias de defesa em profundidade e de manutenção — nenhum reabre a loop.
