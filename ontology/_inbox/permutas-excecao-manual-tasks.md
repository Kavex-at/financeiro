# Tasks: permutas-excecao-manual

**Spec source:** `ontology/_inbox/permutas-excecao-manual-interview.md` (decisões do usuário, 2026-09-15)
· ADR **0047** (em redação pelo OntologyCurator, em paralelo)

**Ontology diff:** sim. O OntologyCurator está editando `ontology/` em paralelo (ADR-0047, nova config
`ExcecaoPermuta`, transição `BLOQUEADA(sem-saldo-permutar) → JA_PERMUTADO` só por exceção manual, motivo
`permutado-fora-do-painel`). `entity_changed = true`: entra uma config nova e um motivo novo. Nenhum
estado novo, porque `ja-permutado` já existe desde a 0054.

**Estimated scope:** **L**. São 8 tasks, ~17 arquivos de produção (1 migration, ~9 backend, ~7 frontend) e ~8
de teste. Tem migration nova (0059), rota nova (POST/DELETE) e UI nova (modal + confirmação). Não tem
handler/job novo nem `infra/`.

> Layout deste repo: `src/backend/` e `src/frontend/` (não `backend/src/`). Gates:
> `cd src/backend && npm run typecheck && npm run lint && npm test`
> `cd src/frontend && npm run typecheck && npm run lint && npm test`
> Numeração reservada: migration **0059** (a 0058 está em `origin/feat/metricas-ciclo`), ADR **0047**.

---

## Achados do scoping (medidos no worktree @ 2f03116, não redescobrir)

### A1. Precedente cliente-filtro (o que espelhar e o que NÃO espelhar)
- Migration `src/backend/migrations/0013_cliente_filtro.sql`: `CREATE TABLE IF NOT EXISTS`, `criado_por`/`criado_em`.
- Repositório `domain/repository/permutas/ClienteFiltroRepository.ts:28-82`: `@injectable()`, SQL `$nome`
  via SqlBuilder, `listPesCodsAtivos()` carregado **uma vez por run** (`EleicaoPermutasService.ts:336`).
- Rotas `routes/permutas.ts:270-316` (`GET/POST /permutas/cliente-filtro`, `DELETE /cliente-filtro/:pesCod`).
  A rota é **singular**: `cliente-filtro`, não `clientes-filtro`. Página: `src/frontend/app/permutas/clientes-filtro/page.tsx`.
  Cliente API: `src/frontend/lib/api.ts:172-205`. Testes: `routes/permutas.test.ts:268` e
  `src/frontend/__tests__/clientes-filtro-api.test.ts`.
- **Não espelhar:** o cliente-filtro não tem serviço (a rota chama o repositório direto), faz hard delete e
  não tem guarda. Aqui é diferente: guarda + transação + soft delete pedem um serviço. O precedente de
  **erro de negócio 422 com `userMessage` pt-BR** é o de alocação: `domain/errors/AlocacaoSaldoError.ts`
  mapeado inline na rota (`routes/permutas.ts:386-396`), e no front `AlocacaoExcedeSaldoError`
  (`lib/api.ts:211-217`, 422 em `criarAlocacao` `:238-265`).

### A2. Auth
Toda mutação de Permutas usa `requireRole('admin')` (`http/auth.ts:205`) e grava o autor como
`req.user?.sub ?? req.user?.email ?? 'unknown'` (ex.: `routes/permutas.ts:293`, `:363`). Leituras (`/gestao`)
ficam só na auth global. Não há `filialAuthz` em Permutas. O teste RBAC fica em
`routes/permutas.test.ts:610-660`, com a lista `mutacoes` em `:614-622`. As rotas novas **entram nessa lista**.
O front não esconde ações por role (nenhum `isAdmin` em `app/permutas`), e o backend devolve 403.

### A3. Sites de constraint/enum do motivo (medido)
| Site | Precisa mudar? |
|---|---|
| `permuta_adiantamento.motivo_bloqueio` / `permuta_candidata_snapshot.motivo_bloqueio` | **Não.** São `TEXT` sem CHECK de domínio (0001:33, 0003:42) |
| CHECK `permuta_adiantamento_sem_estado_colapsado` (0055:40-47) | **Não.** Proíbe só `bloqueada + ja-permutado`. `ja-permutado + permutado-fora-do-painel` passa |
| CHECK `permuta_candidata_snapshot_sem_status_colapsado` (0055:54-64) | **Não.** Mesmo raciocínio. O código antigo (rollback) nunca produz o motivo novo |
| CHECK `permuta_adiantamento_estado_elegibilidade_check` / snapshot `status_check` (0054) | **Não.** O estado `ja-permutado` já é aceito |
| `domain/interface/permutas/EstadoElegibilidade.ts` `MOTIVO_BLOQUEIO` `:54-95` | **Sim.** `PERMUTADO_FORA_DO_PAINEL: 'permutado-fora-do-painel'` + docblock no `JA_PERMUTADO` `:27-45` |
| `Record<MotivoBloqueio, …>` / `assertNever` sobre motivo | **Nenhum site.** Os `assertNever`/`Record` existentes são sobre **estado** (`BALDE_DO_ESTADO`, `GestaoPermutasService:32-49`, `RelatorioExportService.contar:141`) e não mudam, porque não há estado novo |
| `EleicaoPermutasService.countByMotivo` `:1061-1068` | **Não.** Só conta bloqueadas estritas, e a exceção sai desse balde |
| Snapshot `PermutaSnapshotRepository.ts:397-398` | **Não.** Grava `estadoElegibilidade`/`motivoBloqueio` crus. O "mapeamento de `ja-permutado` (ADR-0043)" já é o próprio estado, e o motivo novo vai como string |
| Frontend `app/permutas/components/format.ts` `MOTIVO_LABEL` `:109-121` | **Sim.** `'permutado-fora-do-painel': 'Permutado fora do painel (exceção manual)'` |
| Frontend `app/permutas/components/ui.tsx` `StatusBadge` `:73-82` | **Sim.** O `title` fixo `MOTIVO_LABEL['ja-permutado']` passa a usar o motivo recebido |
| Export `RelatorioExportService.defAdiantamentos` `:155-230` | **Sim.** A coluna `Motivo bloqueio` exporta o **código cru** (`:201`) e não existe mapa de rótulos no backend. Ver A6 |

### A4. Migration 0059 e rollback
- O runner aplica o arquivo inteiro numa transação implícita, com `lock_timeout` (`runMigrations.ts`).
- **Não precisa de rollback file.** A política de `migrations/rollbacks/README.md` exige reverse para `UPDATE` > 1.000
  linhas, e a 0059 é só `CREATE TABLE`/`CREATE INDEX`. Além disso, `migrations/rollbacks.test.ts:44-46`
  fixa a lista exata de reverses (`0054`, `0055`): criar um `0059_*.rollback.sql` quebraria esse teste sem ganho.
- `permuta_adiantamento.doc_cod` é PK (0003:29) e as linhas nunca são deletadas (só `stale`). Mesmo assim
  **não** usar FK: nem `cliente_filtro` nem `permuta_alocacao` (0014) referenciam tabelas da ingestão, e
  a exceção precisa sobreviver a qualquer recarga.

### A5. Onde a exceção entra na ingestão: pós-passe no fim de `computeCandidatas`, não dentro de `buildCandidata`
`computeCandidatas` (`EleicaoPermutasService.ts:309-414`) é o compute **único** da ingestão
(`IngestaoPermutasService.ts:74-78`, cron e botão) e da eleição (`runEleicao:422`). Aplicar ali cobre os
dois caminhos e o snapshot.
**Decisão de scoping:** aplicar num **pós-passe** sobre `candidatas`, depois do fan-out (`:396`) e **antes** de
`contarPorEstado` (`:401`), e não enfiar um parâmetro em `processFilial`/`buildCandidata` (`:486-537`, `:720-833`).
Motivos:
1. **Janela de corrida.** A ingestão só carimba `permuta_adiantamento` no `persistIngestRun`
   (`IngestaoPermutasService.ts:96-122`), minutos depois do início do compute. Se as exceções forem lidas no
   início (como o `filtroPesCods` em `:336`), uma exceção marcada durante uma ingestão em curso seria
   sobrescrita pelo UPSERT. Lidas no fim, a janela cai para segundos, e a ingestão seguinte corrige.
2. **Semântica idêntica.** O pós-passe roda depois do roteamento de cliente-filtro (`:812-833`), que é o
   ponto pedido. O cliente-filtro nunca roteia `sem-saldo-permutar` (exige `!semSaldoPermutar`, `:825`),
   então as duas regras não colidem.
3. **Uma query por run** (`listAtivas()`), sem N+1, e regra pura testável sem mockar o Conexos.
4. `totals` continua saindo da mesma coleção que vai ao snapshot (convergência por construção, `:398-401`).

### A6. Export Excel
O backend não tem rótulo de motivo. A coluna `Motivo bloqueio` sai com o código (`ja-permutado`,
`sem-saldo-permutar`…). Traduzir só o motivo novo deixaria a coluna inconsistente. **Proposta:** a coluna
`Motivo bloqueio` segue crua (`permutado-fora-do-painel`) e entram 4 colunas `Exceção manual`
(`'Permutado fora do painel (exceção manual)'` quando aplicada, `'Registrada, não aplicada'` quando
inativa, vazio sem exceção), `Justificativa exceção`, `Autor exceção` e `Data exceção`. Revisar no PR.

### A7. Estado das linhas depois de marcar/desfazer (efeito imediato)
- `GestaoPermutasService.exporGestao` (`:74-94`) lê `permuta_adiantamento` via `listAdiantamentosAtivos`,
  e os totais/cards derivam do `status` da linha (`:32-49`, `:298-311`). Por isso reclassificar a linha na
  mesma transação já move o card "Já permutado" no "Atualizar". O snapshot e o header da run **não** são
  tocados: são auditoria da run, e a próxima ingestão os refaz.
- **Histórico:** `montarHistorico` só inclui `ja-permutado` **com** `statusPorAdto` (borderô do painel,
  `page.tsx:594-601`). O 8721 não tem borderô, então não aparece, o que cumpre "Histórico: não incluir"
  sem mudança de código.
- `findAdiantamento` (`PermutaRelationalRepository.ts:606-612`) **não** filtra `stale`. A guarda precisa filtrar.
- Desfazer: se a linha está `ja-permutado/permutado-fora-do-painel`, volta a `bloqueada/sem-saldo-permutar`.
  Isso é exato, porque a linha só recebeu o motivo novo quando o calculado era `sem-saldo-permutar` com os
  mesmos dados. Se a linha estiver em outro estado (exceção inativa), faz só o soft delete.

### A8. Frontend
- Ação e detalhe ficam na linha expandida de `VisaoGeralTable.tsx` (`:264-445`). O campo "Motivo" está em
  `:357-362` e o bloco de ação (precedente "Alocar invoice") em `:404-444`. Props em `:32-62`, wiring em
  `page.tsx:842-857`, callbacks com `toast` (sonner) e `load()` em `page.tsx:295-341`, dialogs dinâmicos em `:93` e `:1001`.
- Dialog: `@/components/ui/dialog` (`DialogContent size="md"`, `DialogHeader/Body/Footer`), precedente
  `ConfirmarLoteDialog.tsx`. **Não existe `Textarea`** em `src/frontend/components/ui/`. O DesignSystemReviewer
  decide entre criar o átomo `textarea.tsx` (espelhando `input.tsx`) ou usar `<textarea>` com tokens.
- Helpers puros com teste ao lado: precedente `components/processavel.test.ts`, `components/historico.test.ts`.

### Riscos residuais conhecidos (documentar no PR, não implementar)
- **R1:** exceção marcada nos poucos segundos entre o fim do compute e o commit do `persistIngestRun` é
  sobrescrita nessa run e reaplicada na seguinte.
- **R2:** um blip do Conexos (`detail-indisponivel`) numa run faz o adto aparecer como bloqueado nessa run,
  com o cálculo vencendo. O warn usa mensagem distinta para não parecer mudança real no ERP.
- **R3:** exceção inativa gera 1 `BUSINESS_WARN` por run (3×/dia) até ser desfeita. Isso é intencional.
- **R4:** reverter o deploy do backend (código antigo) com a 0059 aplicada faz a 1ª ingestão devolver o 8721 a
  `bloqueada/sem-saldo-permutar`, sem corromper nada: a tabela de exceções fica intacta e o redeploy restaura.

---

## Task list

### Task 1: Testes que falham: regra de aplicação da exceção e hook na eleição
**Files to change:**
- `src/backend/domain/service/permutas/ExcecaoPermutaService.test.ts` (novo, `describe('aplicarExcecoes')`)
- `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` (factory `:64-69` + mock `buildExcecaoRepo` ao lado de `buildClienteFiltro` `:86-92`; novo `describe` perto do bloco cliente-filtro `:225-283`)
- `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.test.ts` (novo, padrão `ClienteFiltroRepository.test.ts`)

**Acceptance criteria:**
- [ ] `aplicarExcecoes` (puro): candidata 8721 (`BLOQUEADA`, `sem-saldo-permutar`, `pago=true`, `valorPermutar=0`, sem `valorPermutado`) + exceção ativa para `8721` → `estadoElegibilidade=JA_PERMUTADO`, `motivoBloqueio='permutado-fora-do-painel'`, `gatesAvaliados` **inalterado** (Gate 2 segue `passed=false`)
- [ ] mesma candidata **sem** exceção → inalterada (mesma referência ou deep-equal)
- [ ] exceção ativa + calculado `PERMUTA_MANUAL/cliente-filtro` ou `BLOQUEADA/nao-pago` (ex.: `valorPermutar` voltou a 5.000) → estado calculado mantido e 1 aviso `{ docCod, estadoCalculado, motivoCalculado }` devolvido
- [ ] exceção ativa + calculado `JA_PERMUTADO/ja-permutado` (`valorPermutado > 0`) → mantém `ja-permutado` (o motivo do ERP vence) e emite aviso
- [ ] exceção ativa + calculado `BLOQUEADA/detail-indisponivel` → mantém e emite aviso marcado `transiente: true`
- [ ] exceções de `docCod` sem candidata na run → ignoradas, sem aviso nem erro
- [ ] `EleicaoPermutasService.computeCandidatas`: com `listAtivas` mockado com `[8721]` e o detalhe `{ valorPermutar: 0, valorAberto: 0.02 }` → candidata `JA_PERMUTADO/permutado-fora-do-painel`; `totals.totalJaPermutado === 1`, `totals.totalBloqueadas === 0`, `bloqueadasByMotivo` sem `sem-saldo-permutar`
- [ ] `computeCandidatas` com exceção ativa e `valorPermutar=5000` → **não** aplica e `logService.warn` é chamado 1× com `type: LOG_TYPE.BUSINESS_WARN`, mensagem pt-BR e `data` com `docCod`, `estadoCalculado`, `motivoCalculado`, `flowId`
- [ ] `listAtivas` é chamado **exatamente 1×** por `computeCandidatas`, com 2 filiais e N adtos (sem N+1)
- [ ] `ExcecaoPermutaRepository`: `listAtivas` tem SQL com `WHERE removido_em IS NULL`; `insertAtiva(tx, …)` usa `$adiantamentoDocCod`, `$justificativa`, `$criadoPor`; `softDeleteAtiva(tx, …)` faz `SET removido_por = $removidoPor, removido_em = now() WHERE adiantamento_doc_cod = $adiantamentoDocCod AND removido_em IS NULL` e devolve o rowCount; `findAtiva` idem. Nenhum `${}` com dado
- [ ] Os testes existentes de `EleicaoPermutasService.test.ts` passam só com o mock novo injetado (sem mudar asserções)
- [ ] `cd src/backend && npx jest ExcecaoPermuta EleicaoPermutasService` → os testes novos **falham** (vermelho registrado antes das Tasks 2-3)

**Dependencies:** none

---

### Task 2: Migration 0059, motivo novo e repositório `ExcecaoPermutaRepository`
**Files to change:**
- `src/backend/migrations/0059_excecao_permuta.sql` (novo)
- `src/backend/domain/interface/permutas/EstadoElegibilidade.ts` `:54-95` (+ `PERMUTADO_FORA_DO_PAINEL`) e docblock de `JA_PERMUTADO` `:27-45` (nova origem: exceção manual, ADR-0047)
- `src/backend/domain/interface/permutas/ExcecaoPermuta.ts` (novo): `ExcecaoPermuta { id: string; adiantamentoDocCod: string; justificativa: string; criadoPor: string; criadoEm: Date; removidoPor?: string; removidoEm?: Date }`
- `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts` (novo, `@injectable()`): `listAtivas()`, `findAtiva(docCod)`, `insertAtiva(tx, input)`, `softDeleteAtiva(tx, input)`

**Acceptance criteria:**
- [ ] A 0059 cria `permuta_excecao_manual (id BIGSERIAL PRIMARY KEY, adiantamento_doc_cod TEXT NOT NULL, justificativa TEXT NOT NULL, criado_por TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(), removido_por TEXT, removido_em TIMESTAMPTZ)` com `CREATE TABLE IF NOT EXISTS`
- [ ] `CHECK (char_length(justificativa) BETWEEN 10 AND 500)` e `CHECK ((removido_em IS NULL) = (removido_por IS NULL))`, idempotentes (`DROP CONSTRAINT IF EXISTS` + `ADD`, ou inline no `CREATE TABLE IF NOT EXISTS`)
- [ ] `CREATE UNIQUE INDEX IF NOT EXISTS uq_permuta_excecao_manual_ativa ON permuta_excecao_manual (adiantamento_doc_cod) WHERE removido_em IS NULL`
- [ ] Cabeçalho da migration explica: por que tabela e não UPDATE (a ingestão sobrescreve), soft delete como trilha (I5), por que não há FK nem reverse (A4), referência à ADR-0047. SQL estático, sem valor interpolado
- [ ] Aplicar a 0059 duas vezes seguidas (`psql -f` 2×, banco local/dev) não dá erro
- [ ] **Sem** `rollbacks/0059_*`: `migrations/rollbacks.test.ts` passa sem alteração
- [ ] Nenhuma CHECK de `motivo_bloqueio` alterada (A3): `git diff --stat src/backend/migrations/005[45]*` vazio
- [ ] Testes de repositório da Task 1 passam; o mapeamento de linha não usa `!` nem cast solto (`removido_*` opcionais via guard `!= null`)
- [ ] `cd src/backend && npm run typecheck && npm run lint` ✅

**Dependencies:** Task 1

---

### Task 3: Aplicar a exceção no compute único (pós-passe) com `BUSINESS_WARN`
**Files to change:**
- `src/backend/domain/service/permutas/ExcecaoPermutaService.ts` (novo, `@injectable()`): `public aplicarExcecoes = (candidatas: PermutaCandidata[], docCodsComExcecao: Set<string>): { candidatas: PermutaCandidata[]; avisos: AvisoExcecaoInaplicavel[] }` (puro) + `public guardaSatisfeita = (estado, motivo): boolean` (predicado **único**, reusado na Task 5)
- `src/backend/domain/service/permutas/EleicaoPermutasService.ts`: construtor `:195-210` (+ `ExcecaoPermutaRepository`, `ExcecaoPermutaService`); `computeCandidatas` `:396-402` (depois de `perFilial.flat()`/`todasInvoices`, antes de `contarPorEstado`: `listAtivas()` → `aplicarExcecoes` → um `logService.warn` por aviso); docblock da classe `:184-191` (nova etapa)

**Acceptance criteria:**
- [ ] Todos os testes da Task 1 passam
- [ ] `guardaSatisfeita` ⇔ `estado === ESTADO_ELEGIBILIDADE.BLOQUEADA && motivo === MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR`, usando constantes e nunca string crua
- [ ] Mensagem do warn em pt-BR, distinta para `transiente` (ex.: "Exceção manual de permuta não aplicada: estado calculado mudou no ERP" vs "… detalhe do Conexos indisponível nesta run")
- [ ] `ElegibilidadeService.ts` e o roteamento de cliente-filtro (`EleicaoPermutasService.ts:812-833`) **não mudam** (`git diff` sem hunk nesses trechos)
- [ ] `BALDE_DO_ESTADO`, `contarPorEstado` e `countByMotivo` não mudam; `totals` sai da coleção pós-exceção (a mesma do snapshot)
- [ ] Os testes existentes de `IngestaoPermutasService.test.ts` e `PermutaSnapshotRepository.test.ts` passam sem mudar asserções
- [ ] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅
- [ ] PatternGuardian ✅ (DI tsyringe, arrow methods, access modifiers, export de classe)

**Dependencies:** Task 2

---

### Task 4: Testes que falham: marcar/desfazer (serviço e rotas)
**Files to change:**
- `src/backend/domain/service/permutas/ExcecaoPermutaService.test.ts` (novos `describe('marcar')` e `describe('desfazer')`)
- `src/backend/routes/permutas.test.ts` (novo `describe('exceção manual de permuta')` perto de `:355`; + 2 entradas na lista RBAC `:614-622`)
- `src/backend/domain/repository/permutas/PermutaRelationalRepository.test.ts` (`reclassificarAdiantamento`)

**Acceptance criteria:**
- [ ] `marcar({ docCod: '8721', justificativa, criadoPor })` com a linha `bloqueada/sem-saldo-permutar`, `stale=false` → dentro de **um** `withTransaction`: `insertAtiva` + `reclassificarAdiantamento(tx, { docCod, de: {bloqueada, sem-saldo-permutar}, para: {ja-permutado, permutado-fora-do-painel} })`
- [ ] `marcar` com a linha em `nao-pago`, `data-base-indisponivel`, `elegivel`, `permuta-manual` (`cliente-filtro`), `ja-permutado` (`ja-permutado`) → lança `ExcecaoPermutaRecusadaError` (`statusCode 422`, `userMessage` pt-BR citando o motivo atual pelo rótulo), sem `insertAtiva` nem transação aberta
- [ ] `marcar` com linha inexistente ou `stale=true` → erro `statusCode 404`
- [ ] `marcar` com exceção já ativa (`findAtiva` ≠ null, ou violação `23505` do índice parcial dentro da tx) → erro `statusCode 409`
- [ ] Reclassificação concorrente (`reclassificarAdiantamento` devolve 0 porque o `WHERE` com o estado de origem não casou) → rollback da tx e 422 (sem exceção órfã gravada)
- [ ] `desfazer({ docCod, removidoPor })` com exceção aplicada → na mesma tx `softDeleteAtiva` + `reclassificarAdiantamento(de: {ja-permutado, permutado-fora-do-painel}, para: {bloqueada, sem-saldo-permutar})`; com exceção **inativa** (linha em outro estado) → só `softDeleteAtiva`, reclassificação devolvendo 0 **não** é erro
- [ ] `desfazer` sem exceção ativa → `statusCode 404`
- [ ] `PermutaRelationalRepository.reclassificarAdiantamento`: SQL `UPDATE permuta_adiantamento SET estado_elegibilidade = $paraEstado, motivo_bloqueio = $paraMotivo WHERE doc_cod = $docCod AND NOT stale AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo`, 100% parametrizado, retorna rowCount
- [ ] Rota `POST /permutas/adiantamentos/:docCod/excecao-manual` body `{ justificativa: 'ab' }`, `''` ou só espaços → **400** `{ error: 'invalid body' }`; 501 caracteres → 400; body válido → 200 `{ adiantamentoDocCod }` e o serviço recebe `criadoPor === req.user.sub` do token (um `criadoPor` enviado no body é **ignorado**)
- [ ] Serviço lança 422 → rota responde 422 `{ error: code, message: userMessage }`; 404 e 409 idem
- [ ] `DELETE /permutas/adiantamentos/:docCod/excecao-manual` → 200 e `removidoPor === req.user.sub`
- [ ] RBAC: role `authenticated` → **403** nas duas rotas novas (entradas adicionadas em `:614-622`)
- [ ] Os testes novos **falham** antes da Task 5

**Dependencies:** Task 3 (mesmo arquivo de serviço)

---

### Task 5: Implementar marcar/desfazer (serviço transacional, erros e rotas admin)
**Files to change:**
- `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts` (novo, `implements HandlerError`, padrão `AlocacaoSaldoError.ts`): `code` (`EXCECAO_GUARDA_RECUSADA` 422 / `ADIANTAMENTO_NAO_ENCONTRADO` e `EXCECAO_NAO_ENCONTRADA` 404 / `EXCECAO_JA_ATIVA` 409), `userMessage` pt-BR, `retryable=false`
- `src/backend/domain/service/permutas/ExcecaoPermutaService.ts`: `marcar`, `desfazer` (injeta `PostgreeDatabaseClient`, `PermutaRelationalRepository`, `ExcecaoPermutaRepository`, `LogService`); guarda via `guardaSatisfeita` (Task 3)
- `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts`: novo `reclassificarAdiantamento(tx, …)` depois de `findAdiantamento` `:606-612`
- `src/backend/routes/permutas.ts`: schema `excecaoManualBodySchema = z.object({ justificativa: z.string().trim().min(10).max(500) })` junto a `:148-176`; `POST` e `DELETE /adiantamentos/:docCod/excecao-manual` depois de `:398-422`, com `requireRole('admin')`, autor `req.user?.sub ?? req.user?.email ?? 'unknown'` e catch `instanceof ExcecaoPermutaRecusadaError`

**Acceptance criteria:**
- [ ] Todos os testes da Task 4 passam
- [ ] Um único predicado de guarda (`grep -rn "SEM_SALDO_PERMUTAR" src/backend/domain/service/permutas/ExcecaoPermutaService.ts` → só dentro de `guardaSatisfeita`)
- [ ] Marcar e desfazer logam `logService.info` (auditoria, com `docCod` e autor, **sem** a justificativa inteira no log)
- [ ] Nenhuma escrita no Conexos (I4): o serviço não injeta cliente `Conexos*`
- [ ] Sem `process.env` no serviço/repositório; nenhum `new` de dependência (tudo `@inject`)
- [ ] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅
- [ ] PatternGuardian ✅ (SQL parametrizado, tx única, Zod no boundary, arrow methods, access modifiers)

**Dependencies:** Task 4

---

### Task 6: Payload `/permutas/gestao` e export Excel com a exceção
**Files to change:**
- `src/backend/domain/interface/permutas/Gestao.ts` `PermutaPendente` `:83-122`: `excecaoManual?: ExcecaoManualDetalhe` com `{ justificativa: string; criadoPor: string; criadoEm: string /* ISO */; ativa: boolean }`
- `src/backend/domain/service/permutas/GestaoPermutasService.ts`: construtor `:59-72` (+ `ExcecaoPermutaRepository`); `Promise.all` `:74-94` (+ `listAtivas()`); `toPendente` `:323-436` recebe a exceção do adto e devolve `excecaoManual` com `ativa = status === 'ja-permutado' && motivoBloqueio === 'permutado-fora-do-painel'`
- `src/backend/domain/service/permutas/RelatorioExportService.ts` `defAdiantamentos` `:163-190` (colunas) e `:193-225` (linhas): 4 colunas de A6
- `src/backend/domain/service/permutas/GestaoPermutasService.test.ts`, `RelatorioExportService.test.ts` (testes primeiro)

**Acceptance criteria:**
- [ ] (teste primeiro) `GestaoPermutasService`: linha 8721 `ja-permutado/permutado-fora-do-painel` + exceção ativa → `excecaoManual = { justificativa, criadoPor, criadoEm (ISO), ativa: true }`, `status='ja-permutado'` e **sem** `saldoRestante`/`tipoPermuta`
- [ ] linha `permuta-manual` + exceção ativa (inativa) → `excecaoManual.ativa === false`
- [ ] linha sem exceção → sem a chave `excecaoManual`
- [ ] `listAtivas()` chamado 1× por `exporGestao`
- [ ] `totais.jaPermutado` conta o 8721 e `totais.bloqueadas` não conta (derivação existente `:298-311`, sem mudar código de totais)
- [ ] Export: linha com exceção ativa → `Exceção manual = 'Permutado fora do painel (exceção manual)'`, justificativa, autor e data preenchidos; inativa → `'Registrada, não aplicada'`; sem exceção → `null` nas 4
- [ ] Os mocks de DI dos testes existentes ganham o repositório, sem mudar asserções de comportamento
- [ ] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅

**Dependencies:** Task 2 (repositório); Task 5 (evita conflito no DI de testes compartilhados)

---

### Task 7: Frontend: tipos, cliente API, rótulo e helpers (testes primeiro)
**Files to change:**
- `src/frontend/lib/types.ts` `PermutaPendente` `:116-152`: `excecaoManual?: ExcecaoManualDetalhe`
- `src/frontend/lib/api.ts`: `marcarExcecaoManual(docCod, justificativa)` e `desfazerExcecaoManual(docCod)` depois de `criarAlocacao` `:238-265`; `ExcecaoManualRecusadaError` junto de `AlocacaoExcedeSaldoError` `:211-217` (422/409/404 → mensagem do backend)
- `src/frontend/app/permutas/components/format.ts` `MOTIVO_LABEL` `:109-121` (+ motivo novo) e helper `podeMarcarExcecao(p)` (`status === 'bloqueada' && motivoBloqueio === 'sem-saldo-permutar' && !p.excecaoManual`)
- `src/frontend/__tests__/excecao-manual-api.test.ts` (novo, padrão `alocacao-api.test.ts`)
- `src/frontend/app/permutas/components/excecao.test.ts` (novo, padrão `processavel.test.ts`)

**Acceptance criteria:**
- [ ] (teste primeiro) `marcarExcecaoManual`: `POST ${API}/permutas/adiantamentos/8721/excecao-manual` com `content-type: application/json`, auth header e body `{ justificativa }` **sem** autor; 422 com `{ message }` → lança `ExcecaoManualRecusadaError(message)`; 500 → `Error('API 500 …')`
- [ ] `desfazerExcecaoManual`: `DELETE` na mesma URL; `docCod` com `encodeURIComponent`
- [ ] `podeMarcarExcecao`: `true` só para `bloqueada/sem-saldo-permutar` sem exceção; `false` para `nao-pago`, `ja-permutado`, `permuta-manual`, `elegivel` e para `sem-saldo-permutar` com `excecaoManual` inativa
- [ ] `MOTIVO_LABEL['permutado-fora-do-painel'] === 'Permutado fora do painel (exceção manual)'`
- [ ] `cd src/frontend && npm run typecheck && npm run lint && npm test` ✅

**Dependencies:** Task 6 (contrato do payload)

---

### Task 8: Frontend: badge + tag, detalhe, modal de marcar e confirmação de desfazer
**Files to change:**
- `src/frontend/app/permutas/components/ui.tsx` `StatusBadge` `:43-91`: `title` do ramo `ja-permutado` `:73-82` usa `MOTIVO_LABEL[motivo]`; novo `ExcecaoManualTag({ ativa })` ("Exceção manual" em tom neutro/info; "Exceção inativa" em tom warning, com `title` explicando que o cálculo do ERP venceu)
- `src/frontend/app/permutas/components/ExcecaoManualDialog.tsx` (novo): marcar, com resumo do adto (`Campo`), justificativa obrigatória (contador 10–500, botão desabilitado fora da faixa, `aria-describedby`), `Spinner` ao salvar
- `src/frontend/app/permutas/components/DesfazerExcecaoDialog.tsx` (novo, padrão `ConfirmarLoteDialog.tsx`): confirmação com justificativa, autor e data atuais
- `src/frontend/components/ui/textarea.tsx` (novo átomo, **só se** o DesignSystemReviewer aprovar; ver A8)
- `src/frontend/app/permutas/components/VisaoGeralTable.tsx`: tag ao lado do `StatusBadge` `:240-246`; na linha expandida (depois de `:357-362`) bloco "Exceção manual" com Justificativa/Autor/Data (`fmtData`) + botão "Desfazer exceção"; para `podeMarcarExcecao(p)`, botão "Marcar como permutado fora do painel"; props novas `abrirMarcarExcecao`/`abrirDesfazerExcecao` em `:32-62`
- `src/frontend/app/permutas/page.tsx`: estado + callbacks (padrão `adicionarAloc`/`removerAloc` `:295-341`: `toast.success`/`toast.warning` para `ExcecaoManualRecusadaError`/`toast.error`, `isSessionExpiredError`, `await load()`); `dynamic()` dos dialogs junto de `:93`; render junto de `:1001`; props em `:842-857`
- `src/frontend/__tests__/permutas-components.test.tsx` (novos casos)

**Acceptance criteria:**
- [ ] (teste primeiro) `StatusBadge status='ja-permutado' motivo='permutado-fora-do-painel'` renderiza "Já permutado" com `title` "Permutado fora do painel (exceção manual)"; `ExcecaoManualTag ativa` renderiza "Exceção manual" e `ativa={false}` renderiza "Exceção inativa"
- [ ] `ExcecaoManualDialog`: botão confirmar desabilitado com 0–9 caracteres (após trim) e com mais de 500; habilitado com 10; `onConfirmar` recebe o texto com trim
- [ ] `DesfazerExcecaoDialog`: mostra justificativa/autor/data; "Cancelar" não chama `onConfirmar`
- [ ] Linha `bloqueada/sem-saldo-permutar` expandida mostra "Marcar como permutado fora do painel"; linha `nao-pago` não mostra; linha com `excecaoManual` mostra o bloco de detalhe e "Desfazer exceção"
- [ ] Depois de marcar/desfazer com sucesso, `load()` é chamado, e o item muda de card ("Bloqueadas" ↔ "Já permutado") sem nova ingestão
- [ ] 8721 com exceção **não** aparece na aba Histórico (sem `statusPorAdto`, `montarHistorico` inalterado)
- [ ] Textos em pt-BR, só tokens do DS (`bg-info-subtle`, `bg-warning-subtle`…), sem cor crua; ícones `lucide-react` com `aria-hidden`; dialog com `DialogTitle`/`DialogDescription`
- [ ] `cd src/frontend && npm run typecheck && npm run lint && npm test` ✅
- [ ] DesignSystemReviewer gate ✅ (`ui.tsx`, `ExcecaoManualDialog.tsx`, `DesfazerExcecaoDialog.tsx`, `VisaoGeralTable.tsx`, `page.tsx`, `textarea.tsx` se criado)

**Dependencies:** Task 7

---

## Definition of Done

All tasks complete AND:
- [ ] `cd src/backend && npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅
- [ ] `cd src/frontend && npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅
- [ ] PatternGuardian gate ✅
- [ ] `entity_changed=true` ⇒ ontology diff presente em `ontology/` (ADR-0047, config `ExcecaoPermuta`, transição e motivo novos na state-machine `elegibilidade-permuta-candidata`, I5 com trilha de remoção) ✅
- [ ] DesignSystemReviewer gate ✅ (frontend tocado)
- [ ] ObservabilityAdvisor: **não se aplica** (sem handler/job novo; o `BUSINESS_WARN` usa o `LogService` existente)
- [ ] AwsInfraArchitect: **não se aplica** (sem `infra/`)
- [ ] Ground-Truth Validation gate: **N/A, com justificativa no PR** (ver abaixo) ✅
- [ ] Regis-Review gate ✅ (0 P0; P1/P2/P3 e R1-R4 → `ontology/_inbox/permutas-excecao-manual-regis-followups.md`)
- [ ] Rebase de `main` aplicado, gates ainda verdes ✅
- [ ] Delta tem `fix` (e `feat` de UI) em `src/` ⇒ versão do app bumpada (FE+BE lockstep) via `scripts/bump-version.ps1 -Execute` no Ship + `CHANGELOG.md` atualizado ✅

---

## Ground truth: N/A (justificativa) e verificação pós-deploy

**Classificação:** não há lógica monetária. A mudança só reclassifica estado/motivo sobre valores **já lidos**
(`valorPermutar`, `valorAberto`, `valorPermutado`), cujos predicados e tolerância (ADR-0046) não mudam e
já passaram por ground truth ao vivo no `validate-permutas-saldo-ordem-centavos-v1.ts`. Nenhuma fórmula,
nenhum valor novo, nenhuma escrita no Conexos (I4). A exceção é, por definição, a decisão humana
contra a ausência do dado no ERP (`mnyTitPermuta = 0`), então **não existe** fonte nativa para comparar
e um script validaria só a própria regra. Registrar no PR como `SEM_GROUND_TRUTH` por natureza.

**Verificação manual pós-deploy (dev e depois prd, anexar ao PR):**
1. Na Visão Geral, filtrar "Bloqueadas", expandir o **8721** (`Sem saldo a permutar`), clicar em "Marcar como
   permutado fora do painel" e justificar (citar as baixas 21 ↔ 198 de 30/04 e a invoice 7329).
2. "Atualizar": o 8721 aparece em **Já permutado** com a tag **Exceção manual**; o detalhe mostra justificativa,
   autor (usuário logado) e data; `Bloqueadas` diminuiu 1.
3. Rodar a ingestão manual (botão): o 8721 **segue** `Já permutado` + tag; `permuta_candidata_snapshot` da
   run tem `status='ja-permutado', motivo_bloqueio='permutado-fora-do-painel'`; nenhum `BUSINESS_WARN` de exceção.
4. (dev) "Desfazer exceção" → volta a `Bloqueada / Sem saldo a permutar`; `permuta_excecao_manual` tem
   `removido_por`/`removido_em` preenchidos. Remarcar em seguida (o índice parcial permite).
