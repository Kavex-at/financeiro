# Tasks: sispag-remocao-codbar-repetido

**Spec source:** `ontology/_inbox/sispag-guarda-codbar-repetido-amendment-remocao.md` (aprovada) + ontologia v0.41.0 (commit 9e3ddf0)
**Ontology diff:** yes (já aplicado) — `ontology/business-rules/boleto-exige-codigo-de-barras.md` (I16c, I16d, I16d.1–I16d.8, I16e–I16h), `ontology/entities/bloqueio-duplicidade.md` (`origem`, `alertaId?`, `tituloMantido`, `codigoMascarado`), ADR-0069 Emenda 1
**entity_changed:** true (BloqueioDuplicidade) — nenhuma entidade nova (REJECT-DUPLICATE)
**Estimated scope:** L (backend ~10 arquivos + 1 migration + frontend 3 arquivos + 1 medição HML)
**Mode:** `/feature-tweak` sobre a PR-1 (guarda que aborta). Estende; não reescreve.

## Decisões fechadas (não reabrir)

P0-1(a) exceção estreita em lote local `FINALIZADO` durante `gerarRemessa` (status mantido, `versao`+1, evento, total recomputado) · P0-2(a) `BloqueioDuplicidade` ganha `origem` (+ `alertaId?`, `tituloMantido`, `codigoMascarado`) com migration · P0-3(c) retira "lido e repetido" e "lido e descartado (DV inválido)"; **ausência pura e leitura incompleta abortam** · fica um por código (`vencimento → docCod → filCod → titCod`) · ordem local-primeiro (1 transação: remove item + marca + evento), depois `DELETE` com `itsCodSeq` lido ao vivo, depois releitura e confirmação de ausência · etapa de resume `limpar_retirados` · falha fecha (ledger `failed`, `BoletoCodigoBarrasRetiradaIncompletaError` 409) · gate 5.1 do `.REM` continua abort-only · só o código mascarado (5+4) persiste · resultado com `retiradosPorCodigoBarras` + `avisos` não vazio · LoteCard com aviso persistente + selo/desfazer dos retidos.

## Fatos do código que moldam as tasks (verificados em 2026-10-14)

- `AnaliseCodigoBarrasRepetido.analisar` devolve só `grupos` (chaves na ordem de entrada) e `ilegiveis`; **não decide quem fica** e não conhece filial.
- `listarLinhasDigitaveisDoLote` devolve `docCod/titCod` **sem `filCod` e sem `itsCodSeq`** e lê **uma página de 500**; `listarChavesDoLote` devolve `filCod:docCod:titCod` mas não `itsCodSeq`. O `DELETE` exige `filCod`, `itsCodSeq` e `filCodLote`: a leitura precisa ser estendida (Task 3).
- `verificarCodigoBarrasRepetido` (RemessaService:1068) hoje: `lidas < boletos` só `warn` (R3) e segue; `locais` é indexado por `docCod:titCod` (sem filial, homônimo cross-filial possível).
- `removerItemPeloSistema` (LotePagamentoRepository:822) faz `DELETE ... AND l.status = 'RASCUNHO'`; por isso **não serve** para lote `FINALIZADO` (P0-1). Total do lote é derivado dos itens (não há coluna): "recompute" = provar que `valorTotal`/`itens` do resultado refletem o item removido.
- Trilha `sispag_verificacao_evento` tem CHECK de nomes de evento (0078) e é só-inclusão (trigger). `ITEM_REMOVIDO_SISTEMA` já existe e carrega `dados.motivo` (ver P1-Q2).
- `titulo_bloqueio_duplicidade` (0077): `alerta_id` já é NULL-able; índice único parcial `ux_..._ativo` por `(fil_cod, doc_cod, tit_cod) WHERE estado='ATIVO'` (reaproveitado para idempotência de I16d.5). `BloqueioDuplicidadeRepository.criar` exige `alertaId` hoje.
- Filtros de retenção já existem: `TituloAPagarRepository` (~l.242–262, formação) e `LotePagamentoService.incluirTituloNoLote` (~l.240, `DuplicateHoldError`). Ambos leem só "existe ATIVO"; servem às novas origens sem mudar a regra (cobrir com teste).
- Etapas do resume: `ORDEM_ETAPAS = criar_lote, importar, finalizar, gerar_remessa, concluido`; a guarda roda em (2.1) entre import e `finalizarLote`, com `setEtapa('finalizar')` antes dela e só se `retomarDe !== 'concluido'`.
- Migrations: próximo número **0085** (`0084_sispag_sugestao_boleto.sql` é a última). O build copia `*.sql` via `migrations/copy-to-dist.ts`; teste de paridade deve cobrir o arquivo novo (gotcha CLAUDE.md, incidente 2026-09-23).
- Único chamador de `RemessaService.gerarRemessa` em produção: `routes/sispag.ts:1215` (lote manual e automático passam pela mesma rota).

## Ground-truth plan (obrigatório, monetário)

**Status: SEM_GROUND_TRUTH para o comportamento do `DELETE` de `itsCodSeq` inexistente e para o efeito do `DELETE` sobre `titulosCount`/soma do lote nativo** (ontologia P1-5: "não foi medido"). `ontology/ground-truths/` não tem fonte para isto. O que **já** é verificado (HML 2026-10-14): `DELETE` remove item do rascunho nativo (citado em I16 "Limite conhecido (rascunho)"). Plano: Task 12 mede em HML, sintético. O desenho é robusto ao resultado (sucesso = ausência observada na releitura; nunca o status do `DELETE`), então a medição **confirma** o tratamento do caso "já ausente" e não bloqueia a implementação; ela bloqueia o **merge** (ver Task 12). Validação ao vivo em PRD via `GroundTruthValidator` não se aplica: a feature escreve no ERP (DELETE) e não há leitura PRD equivalente sem efeito; a validação de PRD é a releitura embutida (I16d.3 passo 3) mais o roteiro QA da Task 13.

## Task list

### Task 1: Testes que falham (RED) para a análise de quem fica
**Files to change:**
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.test.ts`
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` (só o contrato de tipos, sem lógica, para o teste compilar)

**Acceptance criteria:**
- [ ] Teste: grupo de 3 itens, mesmo código, vencimentos distintos ⇒ fica o de menor `vencimento`; saem os outros 2
- [ ] Teste: vencimento igual ⇒ menor `docCod` (comparação **numérica**: `9` < `10`); depois `filCod`; depois `titCod`
- [ ] Teste: dois grupos independentes retiram 1 de cada; item que fica nunca aparece em `retirar`
- [ ] Teste: ilegível (DV inválido) vai para `ilegiveis` sem "quem fica" (I16d.2); ausência não entra (não é entrada da análise)
- [ ] Teste: saída só carrega `mascarado` e `barras44` interno; `JSON.stringify` do resultado público não contém os 44 dígitos
- [ ] Os testes novos **falham** antes da Task 2 (RED comprovado)

**Dependencies:** none

---

### Task 2: Decisão pura de retirada em `AnaliseCodigoBarrasRepetido`
**Files to change:**
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` (novo método `decidirRetirada(itens: ItemCodigoBarrasComOrdem[])`, mantendo `analisar` intacto para o validador do `.REM`)
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.test.ts`

**Acceptance criteria:**
- [ ] Entrada carrega `{ chave, codigo, filCod, docCod, titCod, vencimento }`; saída `{ retirar: [{chave, mascarado, mantida, motivo:'CODIGO_BARRAS_REPETIDO'}], ilegiveis: [{chave, motivo:'CODIGO_BARRAS_ILEGIVEL'}] }`
- [ ] Sem I/O, sem ledger, sem mensagem (continua pura); reutilizável pelo passo 2 da ADR-0068
- [ ] Tasks 1 verdes; `npm run typecheck` e Biome ok
- [ ] Nenhum import novo de camada de infra

**Dependencies:** Task 1

---

### Task 3: Cliente: leitura com identidade completa e `DELETE` de item do rascunho
**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.ts` (`listarLinhasDigitaveisDoLote` devolve `filCod` e `itsCodSeq` por item/inválido e pagina de verdade; novo `removerItemDoRascunho`)
- `src/backend/domain/client/ConexosSispagWriteClient.test.ts`

**Acceptance criteria:**
- [ ] `listarLinhasDigitaveisDoLote`: cada item e cada `invalidos[]` traz `filCod` (do row; fallback `filCod` do lote) e `itsCodSeq` (do row, validado por Zod; sem `itsCodSeq` ⇒ item tratado como **leitura incompleta**, nunca chute)
- [ ] Leitura pagina até esgotar (`count`/página vazia) em vez de só 500; teste com 501 itens em 2 páginas; truncamento detectável (`completa: boolean`), nunca "lista vazia" em falha (falha sobe `ConexosError`, como hoje)
- [ ] `removerItemDoRascunho({ filCod, bncCod, flpCod, itsCodSeq, filCodItem })` faz `DELETE fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCod}/{filCodLote}` via `base.deleteGeneric`, **tentativa única** (sem retry cego), erro mapeado por `toConexosError`
- [ ] Teste: URL exata montada com os 5 segmentos na ordem da ontologia; `itsCodSeq` vem do argumento (que o chamador leu na hora)
- [ ] Teste: o código completo nunca aparece em log/erro do cliente
- [ ] Retrocompat: chamadores atuais (`RemessaService`, validador) continuam compilando; campos novos são aditivos

**Dependencies:** none (paralelizável com 1–2)

---

### Task 4: Migration 0085 (origem + campos de retenção) e paridade de build
**Files to change:**
- `src/backend/migrations/0085_sispag_bloqueio_origem_codigo_barras.sql`
- `src/backend/migrations/0085_sispag_bloqueio_origem_codigo_barras.test.ts`
- `src/backend/migrations/0085_sispag_bloqueio_origem_codigo_barras.integration.test.ts`

**Acceptance criteria:**
- [ ] `ALTER TABLE titulo_bloqueio_duplicidade ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'DUPLICIDADE_TITULO'`, `titulo_mantido_fil_cod INTEGER NULL`, `titulo_mantido_doc_cod TEXT NULL`, `titulo_mantido_tit_cod TEXT NULL`, `codigo_mascarado TEXT NULL`
- [ ] CHECK `origem IN ('DUPLICIDADE_TITULO','CODIGO_BARRAS_REPETIDO','CODIGO_BARRAS_ILEGIVEL')`
- [ ] CHECK `codigo_mascarado IS NULL OR codigo_mascarado ~ '^[0-9]{5}…[0-9]{4}$'` (**o schema recusa código longo**: I16e); CHECK `codigo_mascarado/titulo_mantido` só nulos em `DUPLICIDADE_TITULO`
- [ ] Linhas existentes ficam `DUPLICIDADE_TITULO` sem reescrita; índice único parcial `ATIVO` inalterado (um ATIVO por título, qualquer origem)
- [ ] Idempotente (`IF NOT EXISTS`/guard em CHECK), só adiciona; rollback documentado no teste de rollbacks existente (`rollbacks.test.ts`) se for o padrão do repo
- [ ] Teste estático: o `.sql` é listado por `copy-to-dist` (paridade build ↔ `MigrationFiles`) — não repetir o incidente 2026-09-23
- [ ] Teste de integração (Postgres de teste): insere `origem` inválida ⇒ erro; máscara com 44 dígitos ⇒ erro
- [ ] **Sem** alteração do CHECK de `sispag_verificacao_evento` caso Q2 seja resolvida como recomendado (reuso de `ITEM_REMOVIDO_SISTEMA`); se a resposta for "evento novo", acrescentar `ALTER ... DROP/ADD CONSTRAINT` nesta mesma 0085

**Dependencies:** none (paralelizável)

---

### Task 5: Testes RED de repositório (retirada em FINALIZADO, marca atômica, idempotência)
**Files to change:**
- `src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts`
- `src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.test.ts`
- `src/backend/domain/repository/sispag/VerificacaoTedPix.integration.test.ts` (ou novo `RetiradaCodigoBarras.integration.test.ts`)

**Acceptance criteria:**
- [ ] Teste: retirada em lote `FINALIZADO` remove o item, **mantém `status`**, `versao`+1, grava evento `ITEM_REMOVIDO_SISTEMA` com `dados.motivo` + identidade + `valor` + `vencimento` + `codigoMascarado` + `tituloMantido`
- [ ] Teste: em `REMESSA_GERADA`/`CANCELADO`/`RASCUNHO`+`manual` o novo caminho **recusa** (retorna `false`, nada gravado): I16d.8 "nenhum outro caminho"
- [ ] Teste: `removerItemPeloSistema` (caminho antigo) continua só RASCUNHO (regressão)
- [ ] Teste: remoção + marca ATIVO + evento na **mesma** transação; falha ao gravar a marca desfaz a remoção (rollback)
- [ ] Teste idempotência I16d.5: repetir a chamada sobre item já removido ⇒ 0 novo evento, 0 nova marca; marca ATIVO preexistente de outra origem não é sobrescrita
- [ ] Teste: `criar` aceita `origem` de código de barras sem `alertaId`; `DUPLICIDADE_TITULO` sem `alertaId` continua inválido onde era
- [ ] Teste: o código completo não aparece em nenhuma coluna/`dados`
- [ ] Falham antes da Task 6

**Dependencies:** Task 4

---

### Task 6: Repositórios: `removerItemPorCodigoDeBarras`, `criar` com origem, consultas de resíduo
**Files to change:**
- `src/backend/domain/interface/sispag/SispagInterface.ts` (`SYSTEM_REMOVAL_REASON` += `CODIGO_BARRAS_REPETIDO`, `CODIGO_BARRAS_ILEGIVEL`; tipos `DuplicateHoldOrigin`, campos novos em `BloqueioDuplicidade`)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (novo método dedicado, status `FINALIZADO` explícito, **não** relaxa `removerItemPeloSistema`)
- `src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.ts` (`criar` com `origem`, `tituloMantido`, `codigoMascarado`, `alertaId?`; `map` com campos novos; `listAtivosPorOrigem`)
- `src/backend/domain/repository/sispag/VerificacaoEventoRepository.ts` (consulta "existe evento do sistema deste motivo para (lote, título)", usada no par marca+evento de I16h(c))
- testes correspondentes

**Acceptance criteria:**
- [ ] Tasks 5 verdes
- [ ] Um único método de repositório recebe `tx` e faz: remoção + `tocarLote` + `criar` marca + evento `ITEM_REMOVIDO_SISTEMA` (+ `BLOQUEIO_CRIADO` pela `criar`); idempotente via `ON CONFLICT ... DO NOTHING` da marca ATIVO (0 inseridas ⇒ não duplica evento)
- [ ] SQL parametrizado; nenhuma interpolação; métodos arrow, modificadores explícitos
- [ ] Mapeamento de linhas legadas devolve `origem = 'DUPLICIDADE_TITULO'`
- [ ] Nenhum campo, tipo ou log carrega o código completo (`codigoMascarado` tipado como string mascarada; construtor/guard recusa 10+ dígitos contíguos)

**Dependencies:** Task 4, Task 5

---

### Task 7: Erro nomeado `BoletoCodigoBarrasRetiradaIncompletaError` + avisos de resultado
**Files to change:**
- `src/backend/domain/errors/BoletoCodigoBarrasRetiradaIncompletaError.ts`
- `src/backend/domain/errors/BoletoCodigoBarrasRetiradaIncompletaError.test.ts`
- `src/backend/domain/errors/BoletoCodigoBarrasRepetidoError.ts` (userMessage de `lote`/`ilegivel` deixa de mandar "retire e descarte": a guarda agora retira; só `arquivo` mantém texto de aborto) + teste
- `src/backend/domain/service/sispag/RemessaService.ts` (somente tipos `RetiradoPorCodigoBarras`, `GerarRemessaResult.retiradosPorCodigoBarras?`/`avisos`)

**Acceptance criteria:**
- [ ] `code = 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA'`, `statusCode = 409`, `retryable = false`; `details` com `flpCod`, títulos pendentes (`docCod/titCod`), nada de código; `message` em inglês de identificador, `userMessage` pt-BR dizendo: o que já saiu, o que falta, que o rascunho nativo ainda contém N itens, que **nada foi enviado ao banco**, que reexecutar a geração termina a limpeza
- [ ] Sanitização defensiva (`\d{10,}` → `…`) igual à do erro existente; teste com código de 44 dígitos injetado em texto livre
- [ ] `userMessage` do `BoletoCodigoBarrasRepetidoError` modo `lote` revisado e testado (sem promessa de "retire manualmente" quando a retirada é automática; modo `arquivo` inalterado, gate 5.1 abort-only)
- [ ] Tipo do item: `{ titulo:{filCod,docCod,titCod}, valor, vencimento, codigoMascarado, tituloMantido? , motivo }`; `avisos: string[]` (pt-BR) não vazio quando `retiradosPorCodigoBarras.length > 0`

**Dependencies:** none (paralelizável)

---

### Task 8: Testes RED do orquestrador (guarda que retira)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.test.ts`

**Acceptance criteria (cada um é um teste que falha antes da Task 9):**
- [ ] Caminho feliz PEDRONI: 3 itens com mesmo código ⇒ 2 retirados, 1 fica (regra de I16d.1), ordem das chamadas **repo.remover(tx) → DELETE nativo → releitura → finalizarLote**; `finalizarLote` só roda com 0 repetido e 0 ilegível (I16d.7)
- [ ] `itsCodSeq` usado no `DELETE` é o da **leitura feita naquele passo** (mock devolve valores distintos entre duas leituras; afirma o da mais recente)
- [ ] Sucesso = ausência observada: `DELETE` retorna 200 mas releitura ainda mostra o item ⇒ `BoletoCodigoBarrasRetiradaIncompletaError`, ledger `failed` com motivo `LIMPEZA_CODIGO_REPETIDO_INCOMPLETA`, `finalizarLote` **não** chamado
- [ ] `DELETE` falha (5xx/404) mas releitura mostra ausência ⇒ segue (observação vence status); falha de **leitura** da releitura ⇒ incompleta, nunca "limpo"
- [ ] Falha parcial: item 1 retirado e confirmado, item 2 falha ⇒ item 1 permanece retirado (local + marca), erro lista só o pendente
- [ ] Ilegível (DV inválido lido): retirado com motivo `CODIGO_BARRAS_ILEGIVEL`, sem `tituloMantido`; **ausência pura** (sem `itsNumCodbar`) e **leitura incompleta** (`completa=false`, `lidas < boletos`, item sem `itsCodSeq`) abortam como antes, **sem nenhuma remoção**
- [ ] Lote que esvazia pela cláusula de ilegível ⇒ erro nomeado, ledger `failed`, nenhum `finalizarLote` (espelho de `BatchEmptiedByCheckError`)
- [ ] Resultado: `retiradosPorCodigoBarras` preenchido, `avisos` não vazio, `itens`/`valorTotal` refletem o lote sem os retirados; sem retirada ⇒ campos ausentes/vazios e `avisos` vazio
- [ ] `LogService.warn` só com mascarado; varredura: nenhum argumento de log/ledger/erro/trilha contém 44 dígitos nem a linha digitável de 47
- [ ] Rede do `.REM` (gate 5.1) continua abortando com `BoletoCodigoBarrasRepetidoError` modo `arquivo`, **sem retirar** (regressão)
- [ ] Homônimo cross-filial: mesmo `docCod/titCod` em filiais diferentes não colapsa (chave com `filCod`)

**Dependencies:** Tasks 2, 3, 6, 7

---

### Task 9: `RemessaService`: guarda que retira, local-first, confirmação por releitura
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (`verificarCodigoBarrasRepetido` passa a decidir/retirar; novo método privado de limpeza; troca do índice `docCod:titCod` por `filCod:docCod:titCod`; `lidas < boletos` vira aborto; `GerarRemessaResult` preenchido)
- eventualmente extrair `src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts` (`@injectable`) se `RemessaService` passar de ~2000 linhas; decisão do implementador, mantendo a guarda chamável do mesmo ponto (2.1)

**Acceptance criteria:**
- [ ] Task 8 verde; `typecheck`, `lint`, `test` verdes
- [ ] Sequência por item: transação local (Task 6) → `removerItemDoRascunho` (Task 3) → releitura completa → confirmação; **nunca** inverte
- [ ] Reaplica I16a após limpar (I16d.7); só então segue para `finalizarLote`
- [ ] `lidas < boletos` ou `completa = false` ⇒ aborta com erro nomeado **antes de qualquer retirada** (P1-Q5 decide a classe); `warn`-e-segue deixa de existir para esse caso
- [ ] Ledger: `setEtapa('finalizar')` mantido antes da guarda; falha ⇒ `ledger.fail` com motivo `LIMPEZA_CODIGO_REPETIDO_INCOMPLETA` e títulos pendentes; retomada possível (ledger não fica `reconciling`)
- [ ] Nenhum `process.env`; `EnvironmentProvider` onde couber; sem `setTimeout` manual (usar `RetryExecutor` apenas para a **releitura**, nunca para o `DELETE`)
- [ ] Mensagens de log/erro ao operador em pt-BR; identificadores em inglês (CLAUDE.md, ADR-0042)

**Dependencies:** Task 8

---

### Task 10: Testes RED + implementação do resume (resíduos, `estranhos`, `limpar_retirados`)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (`ORDEM_ETAPAS` += `limpar_retirados` entre `importar` e `finalizar`; `EtapaReal`; classificação de `intrusos` em `residuos`/`estranhos`; `pular`; ramo de execução; `retomarDe` e `finalizarPendente` em `validarDataDebito`)
- `src/backend/domain/service/sispag/RemessaService.test.ts`

**Acceptance criteria:**
- [ ] RED primeiro, depois verde, um teste por alínea de I16h:
- [ ] (a) item retirado **não é reimportado** na retomada, inclusive importação parcial (`apenas` exclui os retirados; `nossas` = lote local)
- [ ] (b) `estranhos ≠ ∅` ⇒ `indeterminado` **mesmo com resíduos**; nada é deletado
- [ ] (c) resíduo exige o **par** marca ATIVA de origem `CODIGO_BARRAS_*` **e** evento do sistema **neste lote**; retirada por `DUPLICIDADE_TITULO`/I13j **segue intruso** (teste explícito)
- [ ] (d) retomada pela etapa `finalizar` direta (rascunho completo) ainda passa pela guarda (nova ramificação coberta por teste)
- [ ] (e) `estranhos = ∅ ∧ residuos ≠ ∅` ⇒ etapa `limpar_retirados`: `DELETE` dos resíduos (com `itsCodSeq` relido), releitura, reavaliação; depois segue `finalizar`; reexecução idempotente (item já ausente ⇒ sem `DELETE`, sem evento)
- [ ] Resíduo cujo `DELETE` falha ⇒ `BoletoCodigoBarrasRetiradaIncompletaError`; ledger `failed`
- [ ] `pular('importar')` e `pular('finalizar')` coerentes com a etapa nova (tabela de verdade testada)
- [ ] Nenhuma regressão nos testes de `sincronizarComErp` existentes

**Dependencies:** Task 9

---

### Task 11: Retenção: filtros, desfazer e listagem dos retidos por código de barras
**Files to change:**
- `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` (expõe `origem`/`codigoMascarado` na marcação da aba; formação já filtra ATIVO)
- `src/backend/domain/service/sispag/LotePagamentoService.ts` (mensagem do `DuplicateHoldError` conforme origem)
- `src/backend/domain/errors/DuplicateHoldError.ts` (+ origem, mensagem pt-BR distinta)
- `src/backend/domain/service/sispag/DuplicateResolutionService.ts` (`desfazerBloqueio` aceita origem de código de barras; mesma permissão e auditoria; **não** troca o item que ficou)
- `src/backend/routes/sispag.ts` (+ resposta de `gerarRemessa` com `retiradosPorCodigoBarras`/`avisos`; ler retidos para o LoteCard) e `routes/sispag.test.ts`
- `src/backend/domain/service/sispag/FormacaoLotesService.test.ts`, `LotePagamentoService.test.ts`, `DuplicateResolutionService.test.ts`

**Acceptance criteria:**
- [ ] Teste: título com marca `CODIGO_BARRAS_REPETIDO` ATIVA fica fora de `formarLotesAutomaticos` e `incluirTituloNoLote` lança `DuplicateHoldError` com texto da origem (I16g)
- [ ] Teste: desfazer com motivo vazio ⇒ erro; com motivo ⇒ `DESFEITO` + evento `BLOQUEIO_DESFEITO`; título volta ao pool; nova geração com boleto ainda compartilhado o retira de novo com **novo evento** (I16g)
- [ ] Teste: `ENCERRADO` automático nas condições baratas (item mantido pago/`ativo=false` na ingestão; lote de origem `CANCELADO` sem remessa gerada) — o sinal "boleto do título mudou" **fica de fora** (P1-Q8)
- [ ] Rota devolve `retiradosPorCodigoBarras` e `avisos` na resposta 200; `retiradosPorCodigoBarras` ausente quando vazio (compat. com cliente antigo)
- [ ] Endpoint de retidos devolve só campos mascarados; nenhum campo de código completo no JSON (teste de snapshot de chaves)
- [ ] Sem nova permissão

**Dependencies:** Tasks 6, 9

---

### Task 12: Medição HML do `DELETE` de item inexistente (ground-truth)
**Files to change:**
- `src/backend/jobs/probe-hml-delete-item-inexistente.ts` (novo; a ser criado **a partir da branch `chore/sispag-hml-bind-experimentos`**, reaproveitando o harness `probe-hml-item-variantes.ts` / `probe-hml-fin026-titulo.ts`)
- `ontology/_inbox/sispag-remocao-codbar-repetido-hml-achados.md` (registro bruto da medição)
- `ontology/business-rules/boleto-exige-codigo-de-barras.md` (somente I16h/P1-5: trocar "não foi medido" pelo resultado; via OntologyCurator)

**Acceptance criteria:**
- [ ] Roda **somente em HML**: o job recusa executar se a base URL não for HML; credenciais por `HML_ENV_FILE`; **nunca** `.env` de produção (memória: HML recusa usuário de PRD; sessão do robô contaminável); `databaseConnectionString=""` para não gravar sessão em `columbia-default`
- [ ] Apenas códigos **sintéticos** (DV válido gerado, sem relação com boleto real) e título/lote de teste do HML; nenhum dado de PRD
- [ ] Mede e registra, cada caso com `status`, corpo e releitura da lista: (1) `DELETE` de `itsCodSeq` existente ⇒ item some, `titulosCount`/`soma` do lote nativo; (2) segundo `DELETE` do **mesmo** `itsCodSeq` (já ausente); (3) `DELETE` de `itsCodSeq` nunca existente; (4) `DELETE` com `filCod`/`filCodLote` trocados; (5) `DELETE` em lote nativo já `FINALIZADO` (esperado recusar; confirma que a limpeza só funciona pré-finalização)
- [ ] Limpeza: o job cancela/exclui o lote sintético ao final (ou registra o `flpCod` órfão para descarte manual)
- [ ] Resultado confirma ou **invalida** o tratamento da Task 9/10 ("observação vence status"): se o ERP devolver 200 para inexistente, nada muda; se devolver erro, o código já trata (releitura mostra ausência ⇒ sucesso). Qualquer comportamento que contradiga isso reabre Task 9 como P0
- [ ] Task fecha o **status SEM_GROUND_TRUTH** do cabeçalho; sem o registro, a PR **não** é mergeada (gate manual do Yuri)
- [ ] Probe local derruba sessão viva do Conexos: executar com 1 sessão, fora de horário de analista (memória: cap de sessões)

**Dependencies:** Task 3 (cliente). Independente das demais: pode rodar em paralelo, mas deve concluir antes do Ship.

---

### Task 13: LoteCard: aviso persistente, selo/desfazer dos retidos
**Files to change:**
- `src/frontend/lib/sispag.ts` (tipos `RetiradoPorCodigoBarras`, `avisos`, retidos por origem; funções de API; desfazer com motivo) e `src/frontend/lib/sispag.test.ts`
- `src/frontend/app/sispag/components/LoteCard.tsx` (+ `LoteCard.test.tsx`, `LoteCard.verificacao.test.tsx` se a trilha for lida ali)
- `src/frontend/app/sispag/components/GerarRemessaDialog.tsx` (+ test): após sucesso com `avisos`, mostra o resumo em vez de "tudo certo"
- `src/frontend/app/sispag/components/TitulosRetidosBadge.tsx` (novo, átomo/molécula conforme design system) + test
- `src/frontend/app/sispag/page.tsx` (aba de títulos: selo "retido por boleto repetido" + ação desfazer; reutiliza `MotivoDecisaoDialog`)

**Acceptance criteria:**
- [ ] LoteCard exibe aviso **persistente** (não toast) enquanto o lote existir, lido da trilha do lote (sobrevive a recarregar a página); texto pt-BR com `docCod/titCod`, favorecido, valor, vencimento, **código mascarado** e o título que ficou
- [ ] Aviso distingue `CODIGO_BARRAS_REPETIDO` de `CODIGO_BARRAS_ILEGIVEL`; com a falha parcial (`BoletoCodigoBarrasRetiradaIncompletaError`) mostra o `userMessage` do erro e o que fazer
- [ ] Aba de títulos: selo "retido por boleto repetido" com `codigoMascarado` e título mantido; ação **Desfazer** exige motivo (reutiliza `MotivoDecisaoDialog`); após desfazer o selo some e a lista recarrega
- [ ] Nenhuma tela, `title`, `aria-label` ou `console.*` com o código completo (teste varre o DOM renderizado com um código de 44 dígitos no fixture da API e afirma ausência)
- [ ] Acessibilidade: aviso com `role="status"`/`alert` adequado, contraste e foco conforme o design system; tokens do `src/frontend/docs`, sem cor literal
- [ ] `npm run lint`, `typecheck`, `test` em `src/frontend` verdes (não usar `prettier --check`: não é gate)
- [ ] **Gate DesignSystemReviewer ✅** (frontend tocado)

**Dependencies:** Task 11 (contrato da API)

---

### Task 14: Observabilidade e revisão de contrato (sem novo handler)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (apenas pontos de log; sem lógica nova)
- `ontology/_inbox/sispag-remocao-codbar-repetido-tasks.md` (marcar ✅)

**Acceptance criteria:**
- [ ] Não há handler/job novo ⇒ ObservabilityAdvisor **não** é acionado como gate; o `LogService.warn` de retirada tem `type: BUSINESS_WARN`, `data: { loteId, flpCod, retirados, motivos, mascarados }` e **nenhum** código completo
- [ ] Contagem de retiradas fica consultável (log + trilha): o dado para um alerta futuro existe, sem criar dashboard agora
- [ ] Checklist de regressão: o caminho "lote sem repetição" não faz `DELETE`, não grava marca, não altera `GerarRemessaResult` (teste dedicado)

**Dependencies:** Task 9

---

## Ordem TDD

`1 → 2` · `4 → 5 → 6` · `3` e `7` (paralelos) · `8 → 9 → 10` · `11 → 13` · `12` (paralela, antes do Ship) · `14`.
Cada par RED/GREEN é commitado separado quando possível. Nada de Terraform nem `infra/` (inexistente): **AwsInfraArchitect não é acionado**.

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend e frontend)
- [ ] `npm run lint` ✅ (backend e frontend)
- [ ] `npm test` ✅ (inclui testes de migration 0085 e paridade de cópia no build)
- [ ] PatternGuardian gate ✅ (revisa arquivo inteiro: conferir P0 fora do delta contra `main` antes de remediar)
- [ ] entity_changed: ontology diff presente (já commitado 9e3ddf0; atualizar `status`/`implementation_status` de I16d–h para `implemented` e `last_review` ao fim, via OntologyCurator) ✅
- [ ] Frontend tocado: DesignSystemReviewer gate ✅
- [ ] Nenhum handler/job novo: ObservabilityAdvisor n/a; `infra/` inexistente: AwsInfraArchitect n/a
- [ ] Task 12 (medição HML) registrada e o achado refletido na ontologia ✅ (substitui o status SEM_GROUND_TRUTH)
- [ ] Regis-Review reduzido (delta + ~4 QAs: fault-tolerance, security, testability, availability) ✅; só P0 reentra
- [ ] Rebase sobre `main` sem conflito; conferir versão do app, ADR e versão da ontologia em `main` antes de bumpar
- [ ] Delta tem `feat` em `src/` ⇒ bump de versão FE+BE em lockstep (minor) **à mão nos dois `package.json`** (sem pwsh nesta máquina) + `CHANGELOG.md` ✅

## Perguntas abertas (P1, não bloqueiam o início; as marcadas ★ decidem desenho)

- **Q1 ★ Identidade na leitura.** `listarLinhasDigitaveisDoLote` hoje não devolve `filCod` nem `itsCodSeq` e o `locais` do serviço é por `docCod:titCod`. Plano: estender a leitura (Task 3) e passar a chave com filial. Confirmar que o row do `finItemSispag/list` traz `filCod` e `itsCodSeq` (sustentado por I16d.3, mas a Task 12 deve imprimir um row sintético).
- **Q2 ★ Nome do evento de trilha.** I16f fala em evento "`CODIGO_BARRAS_REPETIDO` / `CODIGO_BARRAS_ILEGIVEL`", mas a ontologia diz "uma migration, só para `origem`". O CHECK da 0078 lista nomes de evento. Recomendação: reusar `ITEM_REMOVIDO_SISTEMA` com `dados.motivo` = esses valores (como `SEM_DADO_PAGAMENTO` já faz) e `BLOQUEIO_CRIADO` para a marca; sem tocar o CHECK. Se o Yuri quiser nomes de evento próprios, a 0085 ganha o `ALTER CONSTRAINT`.
- **Q3 Idempotência de evento (I16d.5).** Trilha é só-inclusão; "único por (lote, título, motivo)" não tem índice natural. Recomendação: derivar da marca ATIVA única (`ON CONFLICT DO NOTHING` ⇒ não regrava evento) + consulta de existência em transação. Aceitável?
- **Q4 Nome do erro de lote esvaziado (I16d.7).** A ontologia pede "erro nomeado, espelho de `BatchEmptiedByCheckError`" sem nome. Proposta: `BoletoLoteEsvaziadoPorCodigoError` (409). Confirmar.
- **Q5 ★ Classe do erro e volume na leitura incompleta.** I16c manda abortar leitura incompleta; qual erro? Proposta: reusar `BoletoCodigoBarrasRetiradaIncompletaError` com `modo: 'leitura'`, ou erro próprio. Além disso, lotes com mais de 500 itens: a Task 3 pagina; confirmar que o `list` do fin015 suporta paginação (hoje só `pageNumber: 1`/`pageSize: 500` foi exercitado), senão lotes grandes passam a **abortar sempre**.
- **Q6 Chave do "quem fica" com vencimento ausente.** Item sem `vencimento` local: ordenar por último (não fica)? Proposta: vencimento ausente perde o desempate, e é registrado no evento.
- **Q7 Encerramento automático das marcas de código de barras.** Task 11 implementa só os sinais baratos (mantido pago/inativo; lote de origem cancelado sem remessa). O sinal "boleto do título retido mudou" (`titVldReflexoDdaAssoc`/`fin124`, P1-6) fica fora; sem ele, só o desfazer manual cobre. Aceito?
- **Q8 `avisos` e o cron/automação diária.** O único chamador é a rota; a "automação diária" que não deve tratar como "tudo certo" é o job externo (GitHub Actions) que consome essa rota? Confirmar quem lê `avisos` e se precisa de status HTTP/campo distinto (hoje: 200 + `avisos`).
- **Q9 Interação com ADR-0068 passo 2.** O `PUT finItemSispag` (bind) roda depois do import e reaplica a guarda; esta feature não implementa o passo 2, só mantém a análise reutilizável. Confirmar que nada do passo 2 entra nesta PR.
- **Q10 Desfazer e título ainda no rascunho nativo.** Se a analista desfaz a marca antes da retomada terminar a `limpar_retirados`, o resíduo deixa de ser reconhecido (par marca+evento quebra) e vira `estranho` ⇒ `indeterminado`. Proposta: desfazer recusado enquanto o lote de origem tiver resíduo no rascunho nativo (ledger `failed` pendente). Aceitar ou tratar como `indeterminado` com mensagem?
