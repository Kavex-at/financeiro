# tasks.md — SISPAG: retirar o título do lote e retê-lo da formação automática

> `/feature-tweak sispag "retirar um título do lote pela aba de títulos e impedir que o cron o
> lote de novo"`
> Branch: `fix/sispag-reter-titulo-lote`
> Ontologia: v0.28.0, ADR-0050 (`accepted` em 2026-09-22), invariante I8
> (`business-rules/retencao-formacao-automatica.md`), action `reterTituloDaFormacao`.
> `entity_changed = true` (propriedade nova `TituloAPagar.retencaoFormacao`); diff já commitado.

## Estado de partida

- `listElegiveisParaFormacao` elege todo título ativo, aprovado, não pago, a vencer em até 7 dias e
  fora de lote RASCUNHO. Um título removido de um lote e deixado solto volta na rodada seguinte.
- `removerTitulo` lê `lote.automatico` **fora** da transação e chama `marcarManual` quando ele é
  `true`. Não grava nada sobre o título.
- O painel marca só `emLote: boolean`; a linha não sabe em qual lote o título está.

## Decisões do usuário que o código segue (2026-09-22)

- A lixeira dentro de um lote **automático** também retém; num lote manual, não (P1-1).
- Não há "Reter" num título solto (D5 rejeitada, P1-2).
- Incluir o título à mão libera a retenção (`incluido-no-lote`); "Liberar" libera (`liberado`).

---

### Task 1: Migration 0062 e repositório da retenção

**Files to change:**
- `src/backend/migrations/0062_titulo_retencao_formacao.sql` (novo)
- `src/backend/migrations/retencaoFormacao.test.ts` (novo)
- `src/backend/domain/interface/sispag/SispagInterface.ts`
- `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts` (novo)
- `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.test.ts` (novo)

**Acceptance criteria:**
- Tabela `titulo_retencao_formacao` com chave `(fil_cod INTEGER, doc_cod TEXT, tit_cod TEXT)`, `motivo` opcional até 500 caracteres, `marcado_por`/`marcado_em`, `removido_por`/`removido_em`/`motivo_remocao`, sem FK para `titulo_a_pagar`.
- Índice único parcial `WHERE removido_em IS NULL`: no máximo uma retenção ativa por título.
- CHECK de remoção pareada (`removido_em`, `removido_por` e `motivo_remocao` nulos juntos) e CHECK do enum `motivo_remocao IN ('liberado','incluido-no-lote')`.
- Migration idempotente (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD`), sem valor interpolado; não exige reverse (só cria tabela e índice).
- Repositório `@injectable()` com `listAtivas`, `insertAtiva(tx, …)` idempotente (`ON CONFLICT … WHERE removido_em IS NULL DO NOTHING`) e `liberarAtiva(tx, …)` que devolve 0 ou 1; SQL 100% parametrizado.
- Testes do repositório verificam SQL parametrizado, soft-delete e mapeamento (`marcadoEm` ISO, `motivo` omitido quando nulo).

**Dependencies:** none

### Task 2: I8 na formação automática

**Files to change:**
- `src/backend/domain/repository/sispag/TituloAPagarRepository.ts`
- `src/backend/domain/repository/sispag/TituloAPagarRepository.test.ts`

**Acceptance criteria:**
- `listElegiveisParaFormacao` ganha `NOT EXISTS` contra `titulo_retencao_formacao` com `removido_em IS NULL`, casando `fil_cod`, `doc_cod` e `tit_cod`.
- O anti-join de lote RASCUNHO (I3) e os demais filtros continuam na query.
- Teste novo prova o termo I8 no SQL e que `maxDias` segue parametrizado.

**Dependencies:** Task 1

### Task 3: LotePagamentoService — retirar, reter, liberar e incluir

**Files to change:**
- `src/backend/domain/service/sispag/LotePagamentoService.ts`
- `src/backend/domain/service/sispag/LotePagamentoService.test.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts`
- `src/backend/domain/errors/TituloForaDeLoteError.ts` (novo)
- `src/backend/domain/errors/RetencaoInexistenteError.ts` (novo)

**Acceptance criteria:**
- `LotePagamentoRepository.lerEstadoParaEdicao(loteId, tx)` lê `status` e `automatico` com `SELECT … FOR UPDATE`, dentro da transação.
- `retirarDoLote({filCod, docCod, titCod, motivo?, ator})` acha o lote RASCUNHO do título; sem lote → `TituloForaDeLoteError` (409).
- `retirarDoLote` remove o item, grava a retenção, chama `marcarManual` se o lote era automático e bumpa a versão, tudo numa transação; falha ao gravar a retenção propaga e nada fica pela metade.
- `removerTitulo` (lixeira do lote) lê `automatico` na transação ANTES de `marcarManual` e grava a retenção só quando era automático; num lote manual não chama `insertAtiva`.
- `incluirTitulo` chama `liberarAtiva` com `motivoRemocao='incluido-no-lote'` e `removidoPor = ator` na mesma transação da inclusão.
- `liberarRetencao({filCod, docCod, titCod, ator})` faz soft-delete com `motivoRemocao='liberado'`; sem retenção ativa → `RetencaoInexistenteError` (404).
- Lote não-RASCUNHO segue rejeitado com `LoteEstadoInvalidoError` nas duas remoções.
- Mensagens de auditoria (`LogService`) em português, com `ator`, chave do título e `loteId`.

**Dependencies:** Task 1

### Task 4: Rotas de retirar e liberar

**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.test.ts`

**Acceptance criteria:**
- `POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote` com corpo Zod `{ motivo?: string (trim, ≤ 500) }` devolve `{ lote }`.
- `DELETE /sispag/titulos/:filCod/:docCod/:titCod/retencao` devolve `{ liberado: true }`.
- As duas exigem `requireRole('admin')`; autor sai do JWT (`sub`, senão `email`), nunca do corpo; sem identidade → 401 sem chamar o serviço.
- A lixeira (`DELETE /sispag/lotes/:id/itens/...`) também passa o autor do JWT e responde 401 sem identidade, porque agora pode gravar retenção.
- `filCod` inválido → 400; motivo com mais de 500 caracteres → 400; erros de domínio mapeados para o status deles (409/404).

**Dependencies:** Task 3

### Task 5: Painel projeta o lote e a retenção na linha do título

**Files to change:**
- `src/backend/domain/service/sispag/SispagPainelService.ts`
- `src/backend/domain/service/sispag/SispagPainelService.test.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts`

**Acceptance criteria:**
- `listTitulosEmRascunho` devolve também `loteId` e `automatico`.
- Cada título em lote RASCUNHO carrega `loteRascunho: { id, automatico }`, além de `emLote`.
- Cada título com retenção ativa carrega `retencaoFormacao: { marcadoPor, marcadoEm, motivo? }`.
- Teste do painel cobre título em lote, título retido e título sem nenhum dos dois.

**Dependencies:** Task 1

### Task 6: Cliente frontend

**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/lib/sispag.test.ts`

**Acceptance criteria:**
- Tipos `LoteRascunhoRef` e `RetencaoFormacao` espelham o backend; `TituloAPagar` ganha `loteRascunho?` e `retencaoFormacao?`.
- `retirarDoLote(chave, motivo?)` faz POST na rota nova e só envia `motivo` quando preenchido; devolve o lote.
- `liberarRetencao(chave)` faz DELETE na rota nova; resposta não-ok lança `Error` com a mensagem do backend.
- `docCod`/`titCod` vão com `encodeURIComponent`; testes cobrem URL, método e corpo.

**Dependencies:** Task 4

### Task 7: Linha de "Títulos a pagar" e confirmação da lixeira

**Files to change:**
- `src/frontend/app/sispag/page.tsx`
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/components/RetirarDoLoteDialog.tsx` (novo)
- `src/frontend/app/sispag/components/retencao.ts` (novo)
- `src/frontend/app/sispag/components/retencao.test.ts` (novo)

**Acceptance criteria:**
- A linha do título em lote RASCUNHO mostra o lote ("Lote automático"/"Lote manual") como link que abre a aba "Lotes candidatos", vai à página do lote, rola até ele e o expande.
- A linha em lote RASCUNHO tem "Retirar do lote", que abre confirmação com motivo opcional (≤ 500) e explica que o título não volta a lote automático até ser incluído à mão ou liberado.
- O título retido mostra o badge "Não lotar automaticamente", com autor, data e motivo num tooltip acessível por teclado, e a ação "Liberar".
- Depois de retirar ou liberar, o painel e os lotes recarregam; erros viram toast com a mensagem do backend.
- No `LoteCard`, a lixeira de um lote **automático** pede confirmação dizendo que o título ficará retido da formação automática; num lote manual, a lixeira segue sem confirmação.
- Helpers puros (`rotuloLote`, `detalheRetencao`, `mensagemRemocao`) com testes; tokens do design system, sem cor crua.

**Dependencies:** Task 6

## Plano de Validação Ground-Truth

Não aplicável: nenhuma escrita no ERP e nenhum cálculo monetário. A feature só grava estado local
(Postgres) e filtra a elegibilidade da formação automática.

## Definition of Done

- `npm run typecheck`, `npm run lint` e `npm test` verdes em `src/backend` e `src/frontend`.
- PatternGuardian, DesignSystemReviewer e SpecVerifier aprovados.
- Regis-Review rodado; P0 remediados; P1/P2/P3 em `ontology/_inbox/sispag-reter-titulo-lote-regis-followups.md`.
- `_index.json`/`_coverage.json`: `reterTituloDaFormacao` e `retencao-formacao-automatica` passam a `implemented`.

## QA manual (dev)

1. Formar lotes automáticos; na aba de títulos, um título em lote mostra "Lote automático" e o link leva ao card.
2. "Retirar do lote" com motivo → título sai do lote, o lote vira manual, a linha mostra o badge.
3. "Formar lotes automáticos" de novo → o título retido não entra.
4. Lixeira num lote automático → confirmação fala da retenção; o título aparece retido.
5. Lixeira num lote manual → sem confirmação, sem badge.
6. Incluir o título retido num lote à mão → badge some.
7. "Liberar" num retido → badge some; a próxima formação o lota.
