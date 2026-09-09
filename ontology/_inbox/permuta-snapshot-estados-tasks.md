# Tasks: permuta-snapshot-estados

**Spec source:** `ontology/decisions/0043-ja-permutado-e-fidelidade-do-snapshot-de-eleicao.md` (ADR normativa) + `ontology/business-rules/fidelidade-snapshot-eleicao.md` (invariante I5) + `ontology/state-machines/elegibilidade-permuta-candidata.md` (estado `JA_PERMUTADO`, transição T6)
**Ontology diff:** sim — ADR-0043, `business-rules/fidelidade-snapshot-eleicao.md`, `state-machines/elegibilidade-permuta-candidata.md`, `entities/permuta-candidata.md` (escritos e aprovados pelo Yuri antes deste scoping)
**entity_changed:** true
**Estimated scope:** L (13 tasks · ~20 arquivos de produção · 1 migration com backfill de 152.516 linhas · 1 remoção de rota pública)
**Worktree:** `/home/inteli/kavex-worktrees/permuta-snapshot-estados` (branch `fix/permuta-snapshot-estados`)

> **Layout deste repo:** `src/backend/` e `src/frontend/` — **não** `backend/src/`. Não existe `infra/` nem Terraform: `AwsInfraArchitect` **não** é acionado neste ciclo. Testes ficam ao lado do fonte. Gates rodam em `src/backend`.

## Mapa de risco (ler antes de começar)

| Task | Reversível? | Toca produção? | Observação |
|---|---|---|---|
| 1 | sim (só testes) | não | RED proposital |
| 2, 3 | sim (código) | não (comportamento novo só após a 4) | — |
| **4 (migration 0054)** | **NÃO — DDL + UPDATE em 152.516 linhas** | **SIM** | **maior risco do ciclo**; critérios próprios de idempotência e re-execução |
| 5, 6, 7, 8, 9 | sim (código) | sim (muda números que a operação lê) | dependem da 4 aplicada |
| 10 | **NÃO — deleta rota pública** | sim (`GET /permutas/painel` deixa de existir) | zero call sites confirmados |
| 11 | sim (jobs manuais) | não (probe read-only) | — |
| 12, 13 | sim (docs/ontologia) | não | — |

**Ordem obrigatória:** 1 → 2 → 3 → **4** → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. A Task 4 é barreira: sem a CHECK estendida, todo INSERT das tasks 5+ viola constraint em dev.

---

### Task 1: Testes canônicos da fidelidade e da convergência (RED)

Escrever os testes **antes** de qualquer implementação. Todos devem falhar com o código atual — um teste desta task que passe de primeira é sinal de que não está testando o bug.

**Files to change:**
- `src/backend/domain/repository/permutas/PermutaSnapshotRepository.test.ts`
- `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts`
- `src/backend/domain/service/permutas/ElegibilidadeService.test.ts`

**Acceptance criteria:**
- [ ] **Caso canônico (o da entrevista, obrigatório):** teste que monta uma run com exatamente 1 candidata em cada um dos 5 estados (`elegivel`, `bloqueada`, `casamento-manual`, `permuta-manual`, `ja-permutado`) e assere que `insertCandidataChunk` grava 5 linhas com 5 valores DISTINTOS na coluna `status`
- [ ] **Caso canônico, segunda metade:** na mesma run, `run.total_bloqueadas` é **1** — não 3, não 2
- [ ] **Convergência I5 (cláusula 2):** para a run canônica, `header.total_<s> === COUNT(*) do snapshot com status === s` para os 5 estados (`total_elegiveis`, `total_bloqueadas`, `total_casamento_manual`, `total_permuta_manual`, `total_ja_permutado`) — 5 asserções
- [ ] **Regressão do achatamento (fidelidade, cláusula 1):** candidata `casamento-manual` gravada e relida via `mapSnapshotRow` volta `'casamento-manual'`, nunca `'bloqueada'`; idem para `permuta-manual` e `ja-permutado`
- [ ] **T6 no `ElegibilidadeService`:** adiantamento `pago === true`, gate `VALOR_PERMUTAR` reprovado e `valorPermutado > 0` produz `estadoElegibilidade === ESTADO_ELEGIBILIDADE.JA_PERMUTADO` e `motivoBloqueio === MOTIVO_BLOQUEIO.JA_PERMUTADO` (o motivo permanece, informativo)
- [ ] **Prioridade de causa-raiz preservada:** adiantamento `pago === false` com `valorPermutado > 0` continua `BLOQUEADA` + `nao-pago` — gate 3 vence gate 2, e T6 só dispara em adto pago
- [ ] **Fronteira `sem-saldo-permutar`:** pago, gate 2 reprovado, `valorPermutado === 0` (e também `undefined`) continua `BLOQUEADA` + `sem-saldo-permutar`
- [ ] `npm test` roda e os testes novos falham (RED) por asserção — não por erro de compilação não relacionado

**Dependencies:** none

---

### Task 2: `JA_PERMUTADO` entra em `ESTADO_ELEGIBILIDADE` e a transição T6 passa a existir

**Files to change:**
- `src/backend/domain/interface/permutas/EstadoElegibilidade.ts`
- `src/backend/domain/service/permutas/ElegibilidadeService.ts` (branch `algumGateFalhou` ~`:94-102`; `motivoDoGateFalho` `:148-161`)

**Acceptance criteria:**
- [ ] `ESTADO_ELEGIBILIDADE` ganha `JA_PERMUTADO: 'ja-permutado'`, com docblock citando ADR-0043 e registrando que é estado CONCLUÍDO (≠ reprovação) e terminal dentro de uma run
- [ ] `MOTIVO_BLOQUEIO.JA_PERMUTADO` **permanece** — vira motivo informativo do novo estado, mesmo padrão de `composto-nm`/`CASAMENTO_MANUAL` e `cliente-filtro`/`PERMUTA_MANUAL`; nenhum motivo é removido (taxonomia de motivos é fora de escopo, ADR-0043 §8)
- [ ] O call site que hoje devolve `estadoElegibilidade: BLOQUEADA` + `motivoDoGateFalho(...)` (`ElegibilidadeService.ts:97-101`) passa a devolver `JA_PERMUTADO` quando e somente quando o motivo resolvido for `MOTIVO_BLOQUEIO.JA_PERMUTADO`
- [ ] A lógica de prioridade NÃO é duplicada: o motivo é resolvido uma vez e o estado é derivado dele
- [ ] `motivoDoGateFalho` mantém a ordem `TOTALMENTE_PAGO → VALOR_PERMUTAR → DI_XOR_DUIMP → fallback` inalterada, e o comentário de prioridade continua verdadeiro
- [ ] O branch `data-base-indisponivel` (`:83-89`) e o branch N:M (`:104-124`) não mudam
- [ ] Testes de T6, prioridade e fronteira da Task 1 passam (GREEN)
- [ ] `npm run typecheck` roda; os erros que surgirem em outros arquivos são o INVENTÁRIO de call sites das tasks 3-9 e nenhum é silenciado com cast

**Dependencies:** Task 1

---

### Task 3: `IngestaoPermutasService.toEstadoRow` deixa de mapear o estado novo para `descoberta`

Bug latente **não previsto no briefing**: o `switch` de `toEstadoRow` (`:262-277`) tem `default: return 'descoberta'`. Sem esta task, todo adiantamento `ja-permutado` seria persistido em `permuta_adiantamento.estado_elegibilidade` como `'descoberta'` — trocando um apagamento por outro, sem erro de compilação, porque o `default` engole o caso novo.

**Files to change:**
- `src/backend/domain/service/permutas/IngestaoPermutasService.ts` (`toEstadoRow` ~`:262-277`; docblocks `:55` e `:256-261`; comentário `:123`; `snapshotInput` `:124-134`)
- `src/backend/domain/service/permutas/IngestaoPermutasService.test.ts`

**Acceptance criteria:**
- [ ] `toEstadoRow` ganha `case ESTADO_ELEGIBILIDADE.JA_PERMUTADO: return 'ja-permutado'`
- [ ] Teste: candidata `JA_PERMUTADO` produz `AdiantamentoRow.estadoElegibilidade === 'ja-permutado'` — o teste deve falhar ANTES desta task, devolvendo `'descoberta'`
- [ ] O `default` do switch é auditado: vira exaustivo (`never` check) ou ganha docblock explicando por que `descoberta` é o fallback correto; preferência pela exaustividade, para que o próximo estado novo quebre o build em vez de mentir em silêncio
- [ ] Docblock `:256-261` corrigido — a frase "≠ snapshot, que colapsa N:M → bloqueada para o `/painel`" fica factualmente falsa depois deste ciclo, e o `/painel` deixa de existir (Task 10)
- [ ] Comentário `:123` ("Back-compat `/painel`: mantém o snapshot de candidatas vivo") reescrito: o snapshot é o REGISTRO DE AUDITORIA da eleição (I5), não back-compat de uma rota removida
- [ ] `snapshotInput` (`:124-134`) monta os 5 totais a partir de `totals` (shape novo da Task 6), sem recontagem local
- [ ] Testes existentes de `IngestaoPermutasService` continuam verdes

**Dependencies:** Task 2

---

### Task 4: Migration `0054_estado_ja_permutado.sql` — schema, backfill reconciliado e asserção que aborta

**TASK DE MAIOR RISCO DO CICLO. NÃO reversível: DDL + `UPDATE` em 152.516 linhas de snapshot e 250 linhas de header, em produção.** Ler ADR-0043 §Backfill inteiro, e as migrations 0005 e 0012, antes de escrever uma linha.

**Files to change:**
- `src/backend/migrations/0054_estado_ja_permutado.sql` (novo — 0053 é a última)

**Acceptance criteria:**
- [ ] **Schema:** estende a CHECK de `permuta_adiantamento.estado_elegibilidade` para incluir `'ja-permutado'`, pela mesma técnica idempotente da 0005 e da 0012 (`DROP CONSTRAINT IF EXISTS permuta_adiantamento_estado_elegibilidade_check` + `ADD CONSTRAINT`), sem inventar variação
- [ ] **Schema:** recria a CHECK de `permuta_candidata_snapshot.status` de `('elegivel','bloqueada')` para os 5 estados, mesma técnica
- [ ] **Schema:** `permuta_eleicao_run` ganha `total_casamento_manual`, `total_permuta_manual` e `total_ja_permutado` como `INTEGER NOT NULL DEFAULT 0`, via `ADD COLUMN IF NOT EXISTS`
- [ ] **Ordem:** as CHECKs estendidas vêm ANTES de qualquer `UPDATE` de backfill — senão o próprio backfill viola a constraint antiga
- [ ] **Backfill relacional:** linhas de `permuta_adiantamento` com `estado_elegibilidade='bloqueada' AND motivo_bloqueio='ja-permutado'` passam a `'ja-permutado'` (~80 linhas vivas, medidas em 2026-09-08)
- [ ] **Backfill do snapshot, tabela exata:** `cliente-filtro` → `permuta-manual`; `composto-nm` ou `multiplas-invoices` → `casamento-manual`; `ja-permutado` → `ja-permutado`; demais motivos → `bloqueada`; linhas com `status='elegivel'` ficam INTACTAS (não são tocadas pelo UPDATE)
- [ ] **Backfill do header:** as 3 colunas novas são preenchidas a partir do snapshot da PRÓPRIA run (`GROUP BY run_id, status`), e `total_bloqueadas` é REESCRITO para a contagem estrita nova — sem a reescrita, a invariante I5 nasce violada no histórico (64.893 no header contra 51.459 no snapshot)
- [ ] **Sem caso especial para `kind='ingest'`:** as 264 runs (250 `success` + 14 `error`) não têm snapshot e mantêm totais zerados; as colunas novas nascem `0` sem nenhum ramo condicional
- [ ] `total_elegiveis` NÃO é reescrito — já é íntegro, e é conferido pela asserção abaixo
- [ ] **Asserção obrigatória:** bloco `DO $$ ... RAISE EXCEPTION ... $$` que, por run `kind='eleicao'`, verifica que a reclassificação reproduz os totais que o header já gravava independentemente — `total_elegiveis == COUNT(status='elegivel')`, `total_bloqueadas_legado == COUNT('bloqueada') + COUNT('ja-permutado')`, `total_candidatas == COUNT(*)`
- [ ] **A migration ABORTA** (`RAISE EXCEPTION`, transação inteira revertida) se qualquer run divergir; medido read-only em 2026-09-08 há 0 violações em 250 runs, então um disparo significa que a premissa mudou e o backfill não deve ser aplicado
- [ ] A mensagem da exceção é em PORTUGUÊS (ADR-0042 — é o que o operador lê no incidente) e nomeia a(s) `run_id` divergente(s) e os números de cada lado
- [ ] **Idempotência:** rodar a migration duas vezes seguidas é no-op na segunda — DDL com `IF EXISTS`/`IF NOT EXISTS`, e `UPDATE`s cujo `WHERE` não reclassifica o que já foi reclassificado
- [ ] **Idempotência, o caso perigoso:** verificar EXPLICITAMENTE que a segunda execução não altera `total_bloqueadas`; um backfill escrito como subtração (`total_bloqueadas - total_ja_permutado`) passa na primeira e corrompe na segunda, então o header tem de ser RECOMPUTADO a partir do snapshot
- [ ] **Re-execução após falha parcial:** o script roda em transação única, de modo que uma falha no meio não deixa estado misto; se o runner (`BootMigrator`) não garantir transação por arquivo, confirmar e registrar no PR
- [ ] Comentário de cabeçalho cita ADR-0043 e REVOGA por escrito a decisão de back-compat documentada nas migrations 0005 e 0012, para ninguém re-derivar a projeção binária lendo os arquivos antigos
- [ ] Todo o SQL é DDL/DML estático, sem interpolação de valor em string (Inviolable Rule #5 em espírito)

**Dependencies:** Task 2

---

### Task 5: `PermutaSnapshotRepository` — os dois catch-all morrem; o header ganha 5 buckets

**Files to change:**
- `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts`
- `src/backend/domain/repository/permutas/PermutaSnapshotRepository.test.ts`

**Acceptance criteria:**
- [ ] **Escrita** (`insertCandidataChunk` ~`:317-323`): o ternário `estadoElegibilidade === ELEGIVEL ? 'elegivel' : 'bloqueada'` deixa de existir e a coluna `status` recebe `candidata.estadoElegibilidade` íntegro — zero ramo catch-all
- [ ] **Leitura** (`mapSnapshotRow` ~`:353`): `r.status === 'elegivel' ? 'elegivel' : 'bloqueada'` deixa de existir; o valor da coluna é validado/estreitado para `EstadoElegibilidade` sem fallback silencioso — um valor fora do enum deve falhar alto, não virar `'bloqueada'`
- [ ] `PermutaCandidataSnapshotRow.status` (~`:53`) muda de `'elegivel' | 'bloqueada'` para `EstadoElegibilidade`
- [ ] `PermutaEleicaoRunInput` (~`:15-26`) ganha `totalCasamentoManual`, `totalPermutaManual` e `totalJaPermutado` como campos OBRIGATÓRIOS — opcionais fariam a convergência depender de o caller lembrar
- [ ] `insertRunHeader` (~`:108-137`) grava as 3 colunas novas com SQL parametrizado (`$nome`), sem interpolação
- [ ] `PermutaRunSummary` (~`:31-41`), `mapRunSummary` (~`:240`) e `listRecentRuns` (~`:227-237`) carregam os 3 totais novos
- [ ] `findRunSummaryById` (~`:173-206`, tipo de retorno inline) carrega os 3 totais — é o caminho do REPLAY IDEMPOTENTE (`loadRunAsResult`), que hoje devolveria zeros para os buckets novos sem falhar teste nenhum
- [ ] Caso canônico da Task 1 passa: 5 linhas, 5 status distintos, `total_bloqueadas === 1`
- [ ] Teste de regressão do achatamento passa (round-trip `casamento-manual` → `casamento-manual`)
- [ ] Métodos seguem arrow functions com modificador de acesso explícito; `@injectable()` preservado; nenhum `!` introduzido

**Dependencies:** Task 4

---

### Task 6: `EleicaoPermutasService` — 5 buckets contados por UMA fonte só

A invariante I5 cláusula (2) exige convergência POR CONSTRUÇÃO, não por conferência: header e snapshot têm de usar o mesmo predicado e a mesma contagem. Uma implementação que conte de novo em outro lugar viola a regra mesmo quando os números coincidem por acaso.

**Files to change:**
- `src/backend/domain/service/permutas/EleicaoPermutasService.ts` (totais ~`:335-350`; `EleicaoResult` `:31-43`; replay vazio ~`:203-212`; `loadRunAsResult` ~`:218-231`; `runInput` do caminho feliz ~`:373-383`; `runInput` do branch de erro ~`:409-423`; `countByMotivo` ~`:966`)
- `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts`

**Acceptance criteria:**
- [ ] Os totais deixam de ser dois `filter` avulsos (`elegiveis`/`bloqueadas`, `:335-340`) e passam a sair de UMA agregação única sobre `candidatas` por `estadoElegibilidade` — a mesma coleção passada a `persistRun`; não pode haver dois lugares contando
- [ ] `totals` expõe os 5 buckets (`totalElegiveis`, `totalBloqueadas`, `totalCasamentoManual`, `totalPermutaManual`, `totalJaPermutado`) além de `totalCandidatas` e `bloqueadasByMotivo`
- [ ] `total_bloqueadas` passa a ser a contagem ESTRITA de `ESTADO_ELEGIBILIDADE.BLOQUEADA`, com os `ja-permutado` fora do balde — consequência aceita em ADR-0043 §1 (329 → 249 na run viva)
- [ ] `countByMotivo` (~`:966`) segue alimentado APENAS pelas `bloqueadas` estritas, nunca pelos `ja-permutado` nem pelos manuais; `bloqueadas_by_motivo` continua sendo o detalhamento do passivo externo
- [ ] `EleicaoResult` (`:31-43`) ganha os 3 campos novos
- [ ] Os QUATRO pontos que montam totais são atualizados e nenhum fica com zeros mudos: `runInput` do caminho feliz, `runInput` do branch de erro (5 zeros, coerente — run sem snapshot), `loadRunAsResult` e o replay vazio de `:203-212`
- [ ] Teste de convergência da Task 1 passa contra o resultado real de `runEleicao`, não contra um mock do repositório
- [ ] Log `'permuta eleicao complete'` (`:388-397`) espalha `...totals` e os 5 buckets aparecem, sem renomear campos já consumidos
- [ ] Nenhum `process.env` cru introduzido; DI e arrow functions inalterados

**Dependencies:** Task 5

---

### Task 7: `GestaoPermutasService` — a derivação passa a LER o estado em vez de reconstruí-lo

**Files to change:**
- `src/backend/domain/service/permutas/GestaoPermutasService.ts` (derivação `:263-281`; comentário `:265-268`)
- `src/backend/domain/service/permutas/GestaoPermutasService.test.ts`

**Acceptance criteria:**
- [ ] A cadeia de ternários que termina em `a.motivoBloqueio === 'ja-permutado' ? 'ja-permutado' : 'bloqueada'` é substituída pela leitura direta de `a.estadoElegibilidade` — o estado agora vem íntegro do relacional
- [ ] A reclassificação `ultrapassaInvoice` (ADR-0014, `:270-272`) fica INTOCADA — é ortogonal a este ciclo e mantém a precedência que tem hoje sobre o estado lido
- [ ] O comentário `:265-268` ("sem novo estado no banco (zero migration/reseed)") é removido: ficou factualmente falso com a migration 0054
- [ ] A contagem de `:175-179` (5 buckets) NÃO muda — já estava correta; confirmar que segue verde sem edição
- [ ] Teste: adiantamento com `estadoElegibilidade === 'ja-permutado'` e `motivoBloqueio` AUSENTE aparece como `status: 'ja-permutado'` (hoje viraria `'bloqueada'`), provando que a derivação parou de depender do motivo
- [ ] Testes existentes de `GestaoPermutasService` continuam verdes SEM alteração de expectativa — o painel ao vivo não muda de comportamento (ADR-0043 §Consequências)

**Dependencies:** Task 6

---

### Task 8: Union types do estado — `PermutaRelationalRepository` e `Gestao.ts`

**Files to change:**
- `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts` (`AdiantamentoRow.estadoElegibilidade` `:24-29`; filtro de `listAdiantamentosAtivos` `:507-512`; cast de `:584`)
- `src/backend/domain/interface/permutas/Gestao.ts` (conferir `StatusElegibilidade` ~`:13` e `totais` ~`:175`)
- `src/backend/domain/repository/permutas/PermutaRelationalRepository.test.ts`

**Acceptance criteria:**
- [ ] `AdiantamentoRow.estadoElegibilidade` (`:24-29`) ganha `'ja-permutado'` — hoje o union tem 5 valores e o `as` de `:584` faria um `'ja-permutado'` vindo do banco passar por um tipo que não o comporta
- [ ] O union HARDCODED do filtro `listAdiantamentosAtivos` (`:507-512`) ganha `'ja-permutado'`, para a tela conseguir filtrar pelo estado novo
- [ ] Avaliar extrair o union repetido para um tipo nomeado único (aparece 2× neste arquivo, e é a terceira vez que um estado novo obriga a editar os dois); se não extrair, registrar o porquê no código
- [ ] `Gestao.ts`: confirmado que `StatusElegibilidade` e `totais` já contemplam `ja-permutado`; se faltar algo, completar — e registrar a constatação no PR
- [ ] Teste: `listAdiantamentosAtivos({ estadoElegibilidade: 'ja-permutado' })` compila e emite SQL parametrizado com `$estado`, nunca interpolado (Inviolable Rule #5)
- [ ] `npm run typecheck` verde sem nenhum cast novo escondendo o estado

**Dependencies:** Task 7

---

### Task 9: `JobRunReadModel` — "Últimas rodadas" deixa de ser cega para os 348 itens da nossa fila

**Files to change:**
- `src/backend/domain/service/operacao/JobRunReadModel.ts` (`metricas` do pipeline `PERMUTAS_ELEICAO`, `:182-185`)
- `src/backend/domain/service/operacao/JobRunReadModel.test.ts`

**Acceptance criteria:**
- [ ] `metricas` expõe os 5 buckets (`elegiveis`, `bloqueadas`, `casamentoManual`, `permutaManual`, `jaPermutado`) além de `candidatas`, lidos de `PermutaRunSummary`
- [ ] Verificado neste scoping: `JobRun.metricas` é `Record<string, number>` (`src/backend/domain/interface/operacao/JobRun.ts:62`), então NENHUMA mudança de tipo é necessária e nenhum `as` deve ser introduzido
- [ ] **Consequência de UI — JÁ DECIDIDA pelo Yuri em 2026-09-08, não reabrir:** `src/frontend/app/operacao/page.tsx:234` renderiza as métricas com `Object.entries(...).map(([k, v]) => k + ': ' + v)`, ou seja CHAVE CRUA sem mapa de rótulos. A saída escolhida é **(b) nomear as chaves de forma legível já no backend** — o read-model emite as chaves em português legível (ex.: `'casamento manual'`, `'permuta manual'`, `'já permutado'`), e o renderizador existente produz texto aceitável sem que nenhum arquivo de `src/frontend/` entre no diff
- [ ] Racional a registrar no PR: `JobRunReadModel` é read-model de apresentação, então nomear ali não é vazamento de camada; um mapa de rótulos no frontend acionaria o `DesignSystemReviewer` e ampliaria um tweak de projeção de backend para mudança de UI, fora do escopo da ADR-0043
- [ ] As chaves legíveis valem SÓ para os buckets do pipeline `permutas-eleicao`; NÃO renomeie as chaves dos outros pipelines (recebimentos, sispag, ingest) — mudaria a tela deles sem necessidade
- [ ] Teste: uma run com os 5 buckets preenchidos aparece com os 5 no read-model
- [ ] Os outros pipelines do read-model (recebimentos, sispag, ingest) não mudam
- [ ] Nenhum efeito novo em `bootstrapAppContainer` — gotcha do CLAUDE.md: ele roda em ~58 jobs, com env deliberadamente estreito

**Dependencies:** Task 8

---

### Task 10: Remoção de `GET /permutas/painel` e do `PainelService` (ADR-0043 §5)

**Não reversível dentro do ciclo: remove uma rota pública.** Justificativa registrada: zero call sites no frontend (grep em `src/frontend/`); `PainelService` NUNCA constou de `ontology/_index.json`; a ação `exporNoPainel` segue implementada por `GestaoPermutasService` + `src/frontend/app/permutas/page.tsx`. A remoção deixa a ação com UM implementador em vez de dois — e o que sai é justamente o que achatava.

**Files to change:**
- `src/backend/domain/service/permutas/PainelService.ts` (DELETAR)
- `src/backend/domain/service/permutas/PainelService.test.ts` (DELETAR)
- `src/backend/routes/permutas.ts` (remover a rota `:773-781` e o import `:24`)
- `src/backend/routes/permutas.test.ts` (remover o import `:23` e o `describe('GET /permutas/painel')` ~`:266-315`; SUBSTITUIR o uso em `:688-692`)

**Acceptance criteria:**
- [ ] `PainelService.ts` e `PainelService.test.ts` deletados
- [ ] Rota e import removidos de `routes/permutas.ts`, e nenhuma referência a `PainelService` sobra em `src/backend/` (grep vazio)
- [ ] NÃO confundir com os homônimos: `SispagPainelService`, `RecebimentosPainelService`, `GET /sispag/painel` e `GET /recebimentos/painel` são outros serviços e outras rotas, e não são tocados
- [ ] **`routes/permutas.test.ts:688-692`:** o teste "Leitura NÃO é gateada por role" usa hoje `GET /permutas/painel` como sonda; substituir por outra leitura não-gateada existente (ex.: `GET /permutas/gestao` ou `GET /permutas/runs`) — a asserção de RBAC NÃO pode desaparecer junto com a rota, porque é ela que garante que leitura não virou admin-only por acidente
- [ ] Confirmado neste scoping que `src/frontend/lib/arquitetura/tecnica.ts` não lista `PainelService.ts` (lista `SispagPainelService.ts`, outro arquivo), então nenhuma edição de frontend é necessária por causa da remoção
- [ ] `npm run typecheck` e `npm test` verdes após a remoção

**Dependencies:** Task 9

---

### Task 11: Probes migram para a taxonomia nova

**Files to change:**
- `src/backend/jobs/probe-impacto-verificacao.ts` (`:24`, `WHERE s.status = 'bloqueada'`)
- `src/backend/jobs/probe-impacto-narrativa.ts` (`:32` e `:40-47`, `estado_elegibilidade = 'bloqueada'`)

**Acceptance criteria:**
- [ ] Ambos os probes contam `bloqueada` no sentido NOVO (passivo externo estrito) e, onde relevante, quebram por estado em vez de somar tudo em "bloqueada"
- [ ] Continuam READ-ONLY — nenhuma escrita introduzida
- [ ] SQL parametrizado onde houver valor variável
- [ ] O output do probe diz explicitamente que a série mudou de significado após a 0054, para que uma comparação antes/depois não repita — com o sinal invertido — o erro do relatório de impacto v1 (`docs/impacto/CORRECOES-2026-08-24.md` §1)
- [ ] Mensagens de log e de saída em PORTUGUÊS (ADR-0042); identificadores em inglês

**Dependencies:** Task 4

---

### Task 12: Verificação de fronteira — o que NÃO muda, registrado por escrito

Task de constatação, não de código. Existe para que o gate `DesignSystemReviewer` não seja acionado à toa e para que "não mexemos no frontend" seja uma medição, não uma lembrança. Se algum critério falhar, a constatação vira task nova — não conserte silenciosamente aqui.

**Files to change:**
- nenhum arquivo de produção esperado (task de verificação)

**Acceptance criteria:**
- [ ] **Frontend intocado, confirmado por grep:** `src/frontend/lib/types.ts` (`:30`, `:363`) já tem `'ja-permutado'` em `StatusElegibilidade`, e `app/permutas/components/format.ts` (`:47`, `:169`, `:178`), `components/ui.tsx` (`:74-78`) e `app/permutas/page.tsx` (`:636`, `:750-751`) já tratam o estado
- [ ] Nenhum arquivo em `src/frontend/` alterado neste ciclo, portanto `DesignSystemReviewer` NÃO é acionado — registrar a constatação no PR
- [ ] `git diff --name-only` não contém nenhum caminho sob `src/frontend/`
- [ ] **`RelatorioExportService` não é afetado — já verificado neste scoping:** injeta `GestaoPermutasService` (`:42`) e chama `exporGestao(requestId)` (`:51`), sem tocar o snapshot; reconfirmar após a Task 7 que o export segue casando 1:1 com o painel e que `RelatorioExportService.test.ts` não muda de expectativa
- [ ] Nenhum arquivo sob `infra/` (que não existe neste repo), portanto `AwsInfraArchitect` NÃO é acionado
- [ ] Nenhum handler Lambda ou job NOVO criado (os probes da Task 11 são pré-existentes), portanto `ObservabilityAdvisor` NÃO é acionado

**Dependencies:** Task 11

---

### Task 13: Fechar a ontologia — de `planned` para implementado

**Files to change:**
- `ontology/business-rules/fidelidade-snapshot-eleicao.md`
- `ontology/state-machines/elegibilidade-permuta-candidata.md`
- `ontology/_index.json`
- `ontology/_coverage.json`
- `CHANGELOG.md`

**Acceptance criteria:**
- [ ] `fidelidade-snapshot-eleicao.md`: `has_canonical_test` vai de `false` a `true`, citando o caminho do teste canônico da Task 1; `implementation_status` de `planned` a `implemented`; `status` de `draft` a `accepted`; `last_review` atualizado
- [ ] `elegibilidade-permuta-candidata.md`: `implementation_status` revisto (era `partial`) e confirmado que `migrations/0054_estado_ja_permutado.sql` consta em `related_files`
- [ ] `_index.json`: a entidade `PermutaCandidata` aponta para os arquivos efetivamente tocados, e `PainelService` NÃO entra (nunca esteve, e foi removido)
- [ ] `_coverage.json` atualizado — versão da ONTOLOGIA, não confundir com a versão do app
- [ ] `CHANGELOG.md` registra que a série histórica de "bloqueadas" MUDOU DE SIGNIFICADO (64.893 → 51.459 no agregado; 677 → 249 na run viva) e que isso é correção de classificação, não melhora operacional
- [ ] Nenhuma ADR nova — a 0043 já está escrita e aceita

**Dependencies:** Task 12

---

## Definition of Done

Todas as tasks completas E:

- [ ] `cd src/backend && npm run typecheck` ✅
- [ ] `cd src/backend && npm run lint` ✅ (Biome: 4 espaços, aspas simples, trailing comma, largura 100)
- [ ] `cd src/backend && npm test` ✅
- [ ] Caso canônico verde: run com 1 candidata de cada um dos 5 estados produz 5 linhas de snapshot com 5 status distintos E `run.total_bloqueadas === 1`
- [ ] Invariante I5 verde: `header.total_<s> === COUNT(snapshot WHERE status = s)` para os 5 estados, satisfeita POR CONSTRUÇÃO (fonte única de contagem), não por conferência posterior
- [ ] Migration 0054 idempotente: aplicada 2× seguidas, a segunda é no-op — em especial `total_bloqueadas` não se move na segunda execução
- [ ] Asserção de reconciliação da 0054 não disparou em nenhuma das 250 runs históricas; se disparar, PARA e chama o Yuri, porque a premissa medida em 2026-09-08 mudou
- [ ] PatternGuardian gate ✅ (DDD, tsyringe, SQL parametrizado, arrow functions, modificadores explícitos, zero `!`)
- [ ] SpecVerifier ✅ (verificação cega dos acceptance criteria contra o diff final)
- [ ] entity_changed=true → ontology diff presente ✅ (ADR-0043 + business-rule + state-machine já escritos; Task 13 fecha o front-matter)
- [ ] `src/frontend/` NÃO tocado → DesignSystemReviewer NÃO acionado (constatação da Task 12 no PR)
- [ ] Nenhum handler/job novo → ObservabilityAdvisor NÃO acionado
- [ ] Não existe `infra/` neste repo → AwsInfraArchitect NÃO acionado
- [ ] Regis-Review gate ✅ — P0 remediados; P1/P2/P3 em `ontology/_inbox/permuta-snapshot-estados-regis-followups.md`
- [ ] Rebase de `main` na branch aplicado, gates ainda verdes ✅
- [ ] Delta tem `fix` em `src/` → versão do app bumpada (FE+BE lockstep) via `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md` (commit `chore(release): vX.Y.Z`) ✅

## Riscos e ambiguidades detectados

1. **`toEstadoRow` com `default: 'descoberta'`** (Task 3) — não estava no briefing. Sem a Task 3 o ciclo troca um apagamento (`ja-permutado` → `bloqueada`) por outro (`ja-permutado` → `descoberta`), SEM erro de compilação, porque o `default` engole o caso novo. É o achado mais perigoso deste scoping.
2. **`routes/permutas.test.ts:688-692`** (Task 10) — a rota removida é a sonda do teste de RBAC ("leitura não é gateada por role"). Deletar o bloco inteiro apagaria a asserção de segurança junto. Tem de ser substituída, não removida.
3. **`findRunSummaryById` e o replay vazio de `EleicaoPermutasService:203-212`** (Tasks 5 e 6) — dois caminhos de `EleicaoResult` fáceis de esquecer, que devolveriam `0` nos buckets novos sem quebrar nenhum teste existente.
4. **Migration 0054, reescrita de `total_bloqueadas`** (Task 4) — o único ponto genuinamente destrutivo. Um backfill escrito como subtração passa na primeira execução e corrompe na segunda; tem de ser recomputação a partir do snapshot, e a idempotência tem de ser testada rodando duas vezes.
5. **Contagem em dois lugares** (Task 6) — a I5 cláusula (2) exige convergência por construção. É possível satisfazer os testes contando duas vezes com o mesmo predicado: isso passa e VIOLA a regra. O critério pede fonte única, e o revisor deve olhar para isso especificamente.
6. **Métricas de "Últimas rodadas" viram texto cru na tela** (Task 9) — o frontend imprime a chave do `Record<string, number>` sem mapa de rótulos (`operacao/page.tsx:234`), então os buckets novos aparecem como `casamentoManual: 48`. Arrumar direito exigiria tocar `src/frontend/` e acionar o DesignSystemReviewer, fora do escopo da ADR-0043. Decisão explícita pedida na Task 9; se o Yuri quiser o rótulo legível, vira ciclo próprio.
7. **Semântica da série histórica** (Tasks 11 e 13) — 64.893 → 51.459 é reclassificação, não melhora. Qualquer leitura antes/depois sem essa ressalva repete, com o sinal invertido, o erro do relatório de impacto v1.
