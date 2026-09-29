# Tasks: sync-status-lote-sispag

**Spec source:** ontology/business-rules/sincronizacao-status-lote-sispag.md (I11a–h) · ontology/decisions/0055-status-do-lote-sispag-segue-a-baixa-do-titulo.md · interview/decisões aprovadas no commit b8d8ca7
**Ontology diff:** yes — `ontology/business-rules/sincronizacao-status-lote-sispag.md`, `ontology/decisions/0055-*.md`, `ontology/state-machines/lote-pagamento.md` (L11, tabelas de fechamento, L7 aposentada), `ontology/entities/lote-pagamento.md` (campos novos do item), `ontology/entities/alerta.md` (2 tipos novos), `ontology/integrations/conexos.md` (já commitado, b8d8ca7)
**entity_changed:** true (diff presente)
**Estimated scope:** L (migração + 1 função de domínio + 1 serviço novo + correção de serviço existente + 2 clients + job/workflow + rota + UI)

> **Layout real:** `src/backend/` e `src/frontend/`. Não há `infra/` → AwsInfraArchitect **não** é acionado.
> **Dinheiro + Conexos:** GroundTruthValidator obrigatório (Task 13).

## Task list

### Task 1: Write failing tests for the pure situacao/closing decision (T1–T8 truth table)
**Files to change:**
- `src/backend/domain/service/sispag/DecisaoStatusLote.test.ts` (novo)

**Acceptance criteria:**
- [ ] Tabela de verdade I11d cobre: REJEITADO > PAGO > AGENDADO (BD/00) > SEM_RETORNO; PAGO exige `vldPago = 1 ∧ aberto = 0` (pago com `aberto > 0` não é PAGO)
- [ ] Precedência de eventos por item: várias linhas do mesmo item → evento de maior precedência `REJEITADO > 00 > BD > outro`, independentemente da ordem de leitura (teste com as duas ordens)
- [ ] I11e: algum REJEITADO → `RETORNADO`; todos PAGO → `BAIXADO`; qualquer outra combinação → permanece
- [ ] I11c: leitura do fin064 com falha em qualquer item → item mantém situação anterior e lote **não** transiciona; evento não lido nunca produz REJEITADO
- [ ] I11b: PAGO no fin064 sem nenhum evento lido do fin052 → BAIXADO (T1)
- [ ] T2: fin064 `vldPago = 0` + evento BD → item AGENDADO, lote permanece `REMESSA_GERADA`, nunca `RETORNADO`; gêmeo com `vldPago = 1` → `BAIXADO`
- [ ] T5: um item REJEITADO + outro PAGO → `RETORNADO` + pedido de alerta `sispag-lote-retornado`
- [ ] T8: lote `BAIXADO` com título voltando a aberto → sem transição, `divergencia = true` + alerta `sispag-baixa-divergente`
- [ ] I11f: item REJEITADO com título pago → continua REJEITADO, lote `RETORNADO`, `divergencia = true` + alerta `sispag-baixa-divergente`
- [ ] T4/I11h: entrada idêntica ao estado atual → resultado sinaliza `mudou = false` (sem transição, sem alertas)
- [ ] `origemBaixa`: PAGO ligado a evento de retorno do lote → `REMESSA`; PAGO sem vínculo → `FORA_DO_RETORNO`; PAGO com PSQ_018 ilegível → `NAO_IDENTIFICADA`
- [ ] Testes falham (módulo ainda não existe)

**Dependencies:** none

---

### Task 2: Migration for the new lote item columns
**Files to change:**
- `src/backend/migrations/0069_sispag_item_situacao_sincronizacao.sql` (novo; conferir que 0069 ainda é o próximo livre após rebase na main)
- `src/backend/migrations/rollbacks/0069_sispag_item_situacao_sincronizacao.rollback.sql` (novo)
- `src/backend/migrations/<teste de migração existente ou novo>.test.ts`

**Acceptance criteria:**
- [ ] `lote_pagamento_item` ganha exatamente: `situacao` (nullable, `CHECK (situacao IN ('AGENDADO','PAGO','REJEITADO','SEM_RETORNO'))`), `pago_em`, `pago_observado_em`, `valor_pago`, `origem_baixa` (CHECK `REMESSA|FORA_DO_RETORNO|NAO_IDENTIFICADA`), `baixa_fonte` (CHECK `RETORNO|TITULO`), `divergencia boolean NOT NULL DEFAULT false`, `divergencia_detalhe`, `sincronizado_em` — nomes idênticos a `ontology/entities/lote-pagamento.md`
- [ ] Migração idempotente (`ADD COLUMN IF NOT EXISTS`, constraints nomeadas com guarda)
- [ ] Rollback em `migrations/rollbacks/` (não no nível de cima — não pode ser aplicado no boot)
- [ ] `MigrationFiles.list` inclui `0069_*` e o passo de build `copy-to-dist` a copia para `dist/migrations/` (teste existente de MigrationFiles/copy continua verde)
- [ ] `npm run typecheck` passa

**Dependencies:** none

---

### Task 3: Typed constants and Zod schemas for item sync fields
**Files to change:**
- `src/backend/domain/interface/sispag/SispagInterface.ts`

**Acceptance criteria:**
- [ ] `ITEM_SITUACAO` (`AGENDADO|PAGO|REJEITADO|SEM_RETORNO`), `ORIGEM_BAIXA`, `BAIXA_FONTE` como constantes `as const` + tipos derivados (padrão de `LOTE_STATUS`)
- [ ] Interface do item do lote ganha `situacao?`, `pagoEm?`, `pagoObservadoEm?`, `valorPago?`, `origemBaixa?`, `baixaFonte?`, `divergencia`, `divergenciaDetalhe?`, `sincronizadoEm?` (opcionais com `?`, nunca `| undefined`)
- [ ] Constantes de tipo de alerta `sispag-lote-retornado` e `sispag-baixa-divergente` tipadas (sem string crua nos serviços)
- [ ] `npm run typecheck` passa

**Dependencies:** Task 2

---

### Task 4: fin064 read fail-closed for vldPago (I11c)
**Files to change:**
- `src/backend/domain/client/ConexosSispagClient.ts`
- `src/backend/domain/client/ConexosSispagClient.test.ts`

**Acceptance criteria:**
- [ ] Teste: linha do fin064 com `vldPago` ausente/ilegível **não** vira `pago: false`; a leitura de sincronização reporta "ilegível" (resultado tri-estado ou erro tipado), nunca "não pago"
- [ ] Teste: `vldPago` 1/'1'/true → pago; 0/'0'/false → não pago; `aberto` também lido e validado
- [ ] Novo método de leitura por item para sincronização (`filCod`, `docCod`, `titCod`) **sem** o filtro `vldPago#EQ: 0` usado na carteira; falha HTTP (rede/4xx/5xx) e schema inválido → resultado "ilegível", não exceção que derrube o lote inteiro
- [ ] `boolFromFlag` dos demais campos e o comportamento da carteira (`listTitulosAPagar`) e do `getTituloAPagar` existentes permanecem iguais (testes existentes verdes)
- [ ] `npm run typecheck` passa

**Dependencies:** Task 3

---

### Task 5: listBaixasTitulo enrichment (PSQ_018) with 403 as unreadable
**Files to change:**
- `src/backend/domain/client/ConexosTitulosClient.ts`
- `src/backend/domain/client/ConexosTitulosClient.test.ts` (novo, se não existir)

**Acceptance criteria:**
- [ ] Teste: resposta com `borCod`, `bxaCodSeq`, data e usuário → campos mapeados via Zod (nullable-safe)
- [ ] Teste: 403 (permissão do robô, ver memória rpFin018/com308) → retorna "enriquecimento ausente" (não lança)
- [ ] Teste: 5xx/rede → também "ausente", sem derrubar a sincronização
- [ ] Nenhum caminho de escrita no ERP tocado
- [ ] `npm run typecheck` passa

**Dependencies:** Task 3

---

### Task 6: Implement pure decision function (shared by L9/L10/L11)
**Files to change:**
- `src/backend/domain/service/sispag/DecisaoStatusLote.ts` (novo; classe exportada com métodos arrow, sem I/O)

**Acceptance criteria:**
- [ ] Todos os testes da Task 1 passam
- [ ] Entrada: estado atual do lote e dos itens + leituras (fin064 tri-estado, eventos fin052 agrupados por item, enriquecimento opcional); saída: situação/enriquecimento por item, `destino` (`RETORNADO|BAIXADO|permanece`), `divergencias[]`, `alertas[]`, `mudou: boolean`
- [ ] Sem dependência de env, DB, Conexos ou relógio (data injetada)
- [ ] `npm run typecheck` e `npm run lint` passam

**Dependencies:** Task 1, Task 3

---

### Task 7: Repository — persist item sync fields + transition in one transaction
**Files to change:**
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts`

**Acceptance criteria:**
- [ ] Novo método grava campos dos itens + transição de status numa **única transação**, com optimistic lock por `versao` (I6); conflito → retorno sinalizado (não lança genérico), lote pulado
- [ ] Método "só tocar `sincronizado_em`" que **não** incrementa `versao` (I11h)
- [ ] `findByChaveNativa` aceita o `filCod` **da linha** do retorno (não o do arquivo) — teste com arquivo contendo fil1/flp8 e fil2/flp24 (T3)
- [ ] Listagem de lotes elegíveis: `REMESSA_GERADA`, `RETORNADO` e `BAIXADO` (este só para checagem de estorno)
- [ ] Leitura dos itens devolve os novos campos (para API/UI)
- [ ] SQL 100% parametrizado (`$1`, `$2`)
- [ ] `npm run typecheck` passa

**Dependencies:** Task 2, Task 3

---

### Task 8: Write failing tests for SincronizacaoLoteService (T1–T8 end-to-end with mocks)
**Files to change:**
- `src/backend/domain/service/sispag/SincronizacaoLoteService.test.ts` (novo)

**Acceptance criteria:**
- [ ] T1: fil2/flp24 item 38682/1 com fin064 `vldPago=1, aberto=0`, PSQ_018 borderô 22320 (baixa manual), fin052 só BD → lote `BAIXADO`, item `bor_cod = 22320`, `origemBaixa = FORA_DO_RETORNO`, `baixaFonte = TITULO`
- [ ] T2: fil1/flp8 item 4030/7 `vldPago=0` + BD → permanece `REMESSA_GERADA`, item `AGENDADO`; gêmeo `vldPago=1` → `BAIXADO`
- [ ] T3: um único `.RET` com linhas de fil1/flp8 e fil2/flp24 atualiza os dois lotes (casamento pelo `filCod` da linha)
- [ ] T4: duas passadas sem baixa → nenhuma transição, `versao` inalterada, nenhum alerta; só `sincronizado_em` muda
- [ ] T5: rejeição (`fbeVldTpret = 2`) num item + outro pago → `RETORNADO` + `Alerta sispag-lote-retornado` emitido via `NotificacaoService.emitir`
- [ ] T6: fin064 com erro de rede e com 403 → lote e itens inalterados; PSQ_018 403 com fin064 pago → ainda `BAIXADO` com enriquecimento nulo e `origemBaixa = NAO_IDENTIFICADA`
- [ ] T7: `conexosWriteEnabled=false`, `sispagLiveWriteEnabled=false`, `conexosDryRun=true` → sincronização local persiste normalmente (I11g)
- [ ] T8: lote `BAIXADO` + título reaberto → sem transição, `divergencia=true` + `Alerta sispag-baixa-divergente`
- [ ] REJEITADO + título pago → item continua REJEITADO, lote `RETORNADO`, `divergencia=true` + alerta
- [ ] I11a: nenhum mock de `processar`/`carregar`/baixa é chamado (assert explícito `not.toHaveBeenCalled`)
- [ ] Conflito de versão → lote pulado, demais lotes seguem
- [ ] Only processed fin052 files provide detail: arquivo não processado não gera evento
- [ ] Testes falham (serviço ainda não existe)

**Dependencies:** Task 6, Task 7

---

### Task 9: Implement SincronizacaoLoteService
**Files to change:**
- `src/backend/domain/service/sispag/SincronizacaoLoteService.ts` (novo)
- `src/backend/domain/client/ConexosSispagRetornoClient.ts` (se precisar listar arquivos por config bnc/gtb e ler detalhe só de processados)
- `src/backend/domain/client/ConexosSispagRetornoClient.test.ts`
- `src/backend/domain/appContainer.ts` (apenas registro DI se necessário — **sem** efeito de boot)

**Acceptance criteria:**
- [ ] `@injectable()`, dependências via construtor/tsyringe, `LogService` com mensagens em pt-BR (`'sincronização do lote iniciada'`, `'lote transicionado'`, `'leitura do fin064 falhou'`, ...)
- [ ] Métodos públicos: `sincronizarLote(loteId)` e `sincronizarTodos()`; retorna resumo por lote (transicionou / sem mudança / pulado / erro de leitura)
- [ ] Reusa `ConexosSispagRetornoClient` para fin052 (listar arquivos por configuração bnc/gtb, detalhe só de processados), casando pelo `filCod` da linha
- [ ] Toda decisão passa por `DecisaoStatusLote` (Task 6)
- [ ] Gravações locais **não** consultam `conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun` (I11g); nunca chama `processar`/`carregar` (I11a)
- [ ] Alertas emitidos só quando há mudança (I11h), via mecanismo existente (`NotificacaoService.emitir` / `AlertaRepository.criarSeNovo`)
- [ ] `EnvironmentProvider` em vez de `process.env`
- [ ] Todos os testes da Task 8 passam; `npm run typecheck` e `npm run lint` passam

**Dependencies:** Task 4, Task 5, Task 6, Task 7, Task 8

---

### Task 10: Fix ConciliacaoRetornoService (L9/L10) to use line filCod, per-item precedence and shared closing
**Files to change:**
- `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts`
- `src/backend/domain/service/sispag/ConciliacaoRetornoService.test.ts`

**Acceptance criteria:**
- [ ] Teste de regressão (escrito antes, falhando no código atual): `.RET` com linhas de duas filiais → `findByChaveNativa` chamado com o `filCod` de cada linha
- [ ] Teste de regressão: linhas REJEITADO e BD do mesmo item em qualquer ordem → item REJEITADO (não last-write-wins)
- [ ] Fechamento do lote delega a `DecisaoStatusLote` (mesmos destinos que L11)
- [ ] Teste: com kill-switches desligados, gravações locais ocorrem; `processar` no ERP continua bloqueado pelos gates (`conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun`)
- [ ] Caminho admin `processar` preservado (testes existentes verdes)
- [ ] `npm run typecheck` passa

**Dependencies:** Task 6, Task 7

---

### Task 11: Scheduled job + GitHub Actions workflow
**Files to change:**
- `src/backend/jobs/sincronizar-lotes-sispag.ts` (novo)
- `src/backend/jobs/sincronizar-lotes-sispag.test.ts` (novo)
- `src/backend/package.json` (script `job:sincronizar-lotes-sispag`, se for o padrão dos demais jobs)
- `.github/workflows/sincronizar-lotes-sispag.yml` (novo)

**Acceptance criteria:**
- [ ] Job resolve `SincronizacaoLoteService` via container e chama `sincronizarTodos()`; loga em pt-BR `início`, `lotes lidos`, `transicionados`, `sem mudança`, `pulados`, `falhas de leitura`
- [ ] Exit code ≠ 0 quando **todas** as leituras falham (ex.: Bad Credentials) — evita o "success com 0" visto em 23/09
- [ ] Nada adicionado a `bootstrapAppContainer` (compartilhado por ~58 jobs)
- [ ] Workflow: `cron: '35 11-22 * * 1-5'` (de hora em hora, dias úteis, minuto :35, janela BRT comercial — ajustar faixa UTC se a spec disser outra), `workflow_dispatch`, `concurrency` própria, mesmos secrets/vars de `ingest-sispag.yml` (`DATABASE_CONNECTION_STRING`, `CONEXOS_*`), passo `npm run migrate` antes do job como nos demais
- [ ] Notificação de falha do workflow via padrão existente (`alerta-workflow-falhou.ts`)
- [ ] Teste do job com service mockado passa

**Dependencies:** Task 9

---

### Task 12: API — POST /sispag/lotes/:id/sincronizar and retire L7 (410)
**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/http/buildApp.ts` (mapa de permissões por rota, onde declarado)
- `src/backend/http/routePermissions.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoService.ts` (remover `marcarRetorno`)
- `src/backend/domain/service/sispag/LotePagamentoService.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoApiView.ts` (expor campos novos do item)
- rota nova: teste de rota (`src/backend/routes/sispag.test.ts` ou equivalente existente)

**Acceptance criteria:**
- [ ] `POST /sispag/lotes/:id/sincronizar` exige `P.SISPAG_EXECUTAR` (mesmo nível de finalizar/reabrir); `:id` validado com Zod; retorna o lote atualizado + resumo da passada
- [ ] Conflito de versão → 409; lote em status não sincronizável → 422 (ou convenção existente)
- [ ] `POST /sispag/lotes/:id/retorno` responde **410 Gone** com mensagem pt-BR apontando para "Sincronizar agora"; `'retorno'` removido do loop de ações de `routes/sispag.ts`
- [ ] `routePermissions.test.ts` atualizado (nova rota com `SISPAG_EXECUTAR`; rota antiga documentada como 410)
- [ ] API view do lote inclui por item: `situacao`, `pagoEm`, `valorPago`, `origemBaixa`, `borCod`, `divergencia`, `divergenciaDetalhe`, `sincronizadoEm`
- [ ] Sem novo framework HTTP; handler fino → service
- [ ] `npm run typecheck`, `npm test` passam

**Dependencies:** Task 9

---

### Task 13: Frontend — "Sincronizar agora", per-item situação, remove "Marcar retorno recebido"
**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/components/LoteCard.test.tsx`

**Acceptance criteria:**
- [ ] `lib/sispag.ts`: `marcarRetorno` removido; `sincronizarLote(id)` adicionado; tipos do item incluem os campos novos
- [ ] `LoteCard`: botão "Sincronizar agora" visível em `REMESSA_GERADA`/`RETORNADO`/`BAIXADO` para quem tem `sispag:executar`; estado de carregamento e erro tratados
- [ ] Botão "Marcar retorno recebido" removido (teste garante ausência)
- [ ] Cada item mostra badge de situação (AGENDADO/PAGO/REJEITADO/SEM_RETORNO) e indicador de divergência com detalhe; card mostra "sincronizado em <data>"
- [ ] Lote `RETORNADO` destacado visualmente (tokens do design system)
- [ ] `npm run typecheck`, `npm run lint`, `npm test` (frontend) passam

**Dependencies:** Task 12

---

### Task 14: Ground-truth validation plan (GroundTruthValidator)
**Files to change:**
- `src/backend/jobs/validate-sync-status-lote-sispag-v1.ts` (escrito pelo GroundTruthValidator após o verde; read-only)

**Acceptance criteria:**
- [ ] Amostra: lotes do PG230901.REM — fil 1/flp 8 (item 4030/7) e fil 2/flp 24 (item 38682/1)
- [ ] Ground truth: `fin064` (Valor Pago / Aberto por `docCod`) + `fin010` borderô 22320
- [ ] Esperado: 38682/1 → `PAGO`, `origemBaixa = FORA_DO_RETORNO`, `borCod = 22320` se PSQ_018 legível (senão `NAO_IDENTIFICADA`); 4030/7 conforme fin064 do dia; lote só `BAIXADO` se ambos pagos
- [ ] Tolerância: zero divergência em situação e destino do lote; valor pago exato ao centavo
- [ ] Script roda com `databaseConnectionString=""` (não contaminar sessão do robô) e **sem escrita** no ERP nem no banco
- [ ] Divergência = P0 que reentra no loop

**Dependencies:** Task 9, Task 10

---

### Task 15: Observability review for the new job
**Files to change:**
- (nenhum até o parecer) — possivelmente `src/backend/jobs/sincronizar-lotes-sispag.ts`

**Acceptance criteria:**
- [ ] ObservabilityAdvisor revisou `sincronizar-lotes-sispag` (job) e `SincronizacaoLoteService`: logs estruturados com `loteId`, `filCod`, contadores por passada; falha total de leitura visível (não "success com 0")
- [ ] Recomendações P0 aplicadas; demais registradas em `_inbox`

**Dependencies:** Task 11

---

### Task 16: Update ontology implementation status and index
**Files to change:**
- `ontology/business-rules/sincronizacao-status-lote-sispag.md` (`implementation_status`, `has_canonical_test: true`)
- `ontology/_index.json`
- `ontology/_coverage.json`

**Acceptance criteria:**
- [ ] `_index.json` mapeia `LotePagamento` para `SincronizacaoLoteService.ts`, `DecisaoStatusLote.ts`, job e migração 0069
- [ ] `implementation_status: implemented` e teste canônico apontado (`DecisaoStatusLote.test.ts`)

**Dependencies:** Task 9, Task 12, Task 13

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (src/backend e src/frontend)
- [ ] `npm run lint` ✅ (src/backend e src/frontend)
- [ ] `npm test` ✅ (src/backend e src/frontend)
- [ ] PatternGuardian gate ✅
- [ ] ontology diff in `ontology/` present ✅ (b8d8ca7)
- [ ] DesignSystemReviewer gate ✅ (LoteCard.tsx tocado)
- [ ] ObservabilityAdvisor review ✅ (novo job `sincronizar-lotes-sispag`)
- [ ] GroundTruthValidator ✅ (PG230901.REM, fin064 + fin010 borderô 22320)
- [ ] Regis-Review gate ✅ (P0 remediados; P1–P3 em `_inbox/sync-status-lote-sispag-regis-followups.md`)
- [ ] migração 0069 presente em `dist/migrations/` após `npm run build` ✅
- [ ] app version bumped (FE+BE lockstep) — `fix` em `src/` → patch/minor conforme delta; aplicar à mão nos dois `package.json` (sem pwsh nesta máquina) + `CHANGELOG.md`; conferir versão real da main antes ✅
