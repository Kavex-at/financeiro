# Tasks: permutas-baixa-integridade

**Spec source:** `ontology/decisions/0043-baixa-parcial-vira-estado-terminal-em-vez-de-erro.md` (ADR-0044)
· `ontology/business-rules/idempotencia-reconciliacao.md` (I-Recon-1/5/6/7)
· `ontology/business-rules/fin010-write-contract.md` (I-Write-8a/8b)
· `ontology/state-machines/status-permuta-bordero.md` (B1')
· `ontology/_inbox/permutas-baixa-integridade-followups.md`

**Ontology diff:** sim — já aplicado neste worktree pelo `OntologyCurator` (ADR-0044,
`entity_changed = true`). O código está **atrás** da ontologia de propósito; `_coverage.json`
registra `Permuta.impl_pct` em 85 e volta a 90 na Task 13.

**Origem:** Regis-Review `docs/regis-review/2026-09-08-1414-permutas/` — **R-1** (`fault-tolerance-1`,
P0), **R-2** (`fault-tolerance-4`), **T2** (`testability-4`), **T3** (`testability-5`).
**Fora de escopo, deliberado:** os outros 55 cards do run, incluindo `cc-reaper-permutas`
(ver "Invariante parcialmente cumprido" no fim) e `modifiability-9` (âncoras stale).

**Estimated scope:** **L** — 14 tasks: 4 invariantes novos, 2 classes de erro, 1 migration, 2 uniões
de tipo espelhadas à mão, 1 máquina de estados, ~13 arquivos de produção + 5 de teste. Nenhum deles é
grande; o tamanho vem da quantidade de seams distintos que precisam concordar entre si.

> **Comece pela Task 14.** Ela é P0 e **bloqueia as Tasks 7 e 8**: o scoping refutou uma premissa da
> própria ADR-0044 (`titVldStatus = 1` é **ATIVO**, não "em aberto" — ver **C-1**), e a fórmula de
> cobertura de I-Write-8a depende de uma decisão de domínio que ainda não foi tomada. As demais
> tasks (R-1/I-Recon-5, `parcial`/I-Write-8b, B1') **não** dependem dela e podem correr em paralelo.

---

## Mapa de arquivos (medido no worktree, 2026-09-08)

> ⚠️ Este repo é `src/backend/` e `src/frontend/` — **não** `backend/src/`. Não existe `infra/`.

| Arquivo | Papel no delta |
|---|---|
| `src/backend/migrations/0056_permuta_execucao_parcial.sql` | **novo** — CHECK + `valor_residual_usd` (próximo livre confirmado: `0053_job_execucao.sql` é o último) |
| `src/backend/domain/errors/ReconciliacaoEmAndamentoError.ts` | **novo** — 409, espelho de `RemessaEmAndamentoError.ts` |
| `src/backend/domain/errors/AlocacaoSemCoberturaError.ts` | **novo** — 422, irmão-déficit de `AlocacaoSaldoError.ts` |
| `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts` | `ExecucaoStatus:5`, `beginExecution:226-266`, `markSettled:287`, `mapRow:461`, SELECTs (5 listas de colunas: 73, 85, 131, 147, 173) |
| `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | `reconciliar:99`, `executarBaixa:353-460`, `borderoAindaValido:811`, construtor `:83-97` |
| `src/backend/domain/service/permutas/ReconciliacaoLotePermutaService.ts` | contadores `:126-129`, `statusDoAdto:177-187` |
| `src/backend/domain/service/permutas/BorderoGestaoService.ts` | `PermutaStatus:21`, `statusPorAdiantamento:488`, filtro `:495` |
| `src/backend/routes/permutas.ts` | rota `/reconciliar:489-512` (hoje **sem** `respondHandlerError`) |
| `src/frontend/lib/types.ts` | `ExecucaoStatus:255`, `ExecucaoPermuta:302`, `PermutaStatusBordero:319` |
| `src/frontend/app/permutas/components/ui.tsx` | `PermutaBorderoBadge:118-133` |

---

## Restrições medidas ANTES do loop (não redescobrir)

Estas foram verificadas no código deste worktree. São a razão de várias acceptance criteria
existirem na forma em que estão.

### C-1 · `Σ titulos.usd` **não é** a soma dos títulos em aberto — nem um limite superior, nem inferior

Corrigido em 2026-09-08 pelo GroundTruthValidator e **verificado por mim** no swagger versionado
deste repo. A versão anterior desta restrição dizia "limite inferior"; estava incompleta, e a
incompletude era a parte perigosa.

`ConexosTitulosClient.listTitulosAPagar` (`ConexosTitulosClient.ts:230`) tem **dois** desvios
independentes, em direções opostas:

**(a) O filtro não filtra pagamento.** `filterList: { 'titVldStatus#EQ': '1' }` — e
`titVldStatus` é o **ciclo de vida do registro**, não o estado de pagamento:

```
"titVldStatus": { "description": "Situação do Título<ul><li>1 - ATIVO</li>
                  <li>2 - RENEGOCIADO</li><li>3 - CANCELADO</li></ul>", "enum": [1,2,3] }
```

(`docs/conexos-api/070-com3.json`, schema **`FinTituloFin`** — exatamente o
`serviceName: 'com308.finTituloFin'` que o client envia.) O eixo de pagamento é **outro campo, no
mesmo DTO**: `"pago": 1 - TOTALMENTE PAGO / 2 - PARCIALMENTE PAGO / 3 - NÃO PAGO`.

Logo `titVldStatus=1` devolve **todos os títulos ativos, inclusive os já quitados**. E o `usd` que
`executarBaixa:380` extrai é `t.valorNegociado` (= `titMnyValorMneg`, **valor de face**), sem
subtrair nada. `Σ titulos.usd` **superestima** a cobertura em todo o valor dos títulos já pagos.

**(b) A página é única e o `count` é descartado.** `pageNumber: 1, pageSize: 100` — e o envelope
`count` do ERP é jogado fora por `legacyConexosAdapter` (`listGeneric` devolve `rows ?? data`),
então o truncamento é hoje **estruturalmente indetectável**. Isso **subestima**. Pior: o teto real
não é necessariamente 100 — há medição em HML (`ConexosGerDocProcessoClient.ts:928-931` + teste
`:541-566`) em que pedimos `pageSize: 500` e o ERP devolveu **50 linhas com `count: 86`**. **O ERP
impõe a própria página.**

**Consequência para I-Write-8a:** a fórmula `Σ(titulos.usd) < valorAlocado − 0,005` compara o
alocado contra a **face bruta dos títulos ativos**. Ela dispara **menos** do que a ADR-0044
pretende — só quando a alocação excede até o valor cheio de títulos já pagos. O gate fail-closed
nasce sistematicamente **frouxo**, e frouxo do lado que empurra caso previsível para o `parcial`,
que é justamente o que 8a existia para evitar. Não é erro de digitação: a fórmula foi escrita sobre
a premissa — agora refutada — de que o filtro entrega "em aberto".

**A guarda de truncamento continua obrigatória, com o critério certo:** não `rows.length === 100`
(número errado), e sim **`rows.length !== count`** — o que exige parar de descartar o `count`.

### C-2 · O fallback de título único é o caminho majoritário e **não** pode disparar 8a

`executarBaixa` (`ReconciliacaoPermutaService.ts:398`): lista vazia (ERP indisponível, catch, ou
zero linhas) ⇒ `titulos = [{ titCod: 1, usd: aloc.valorAlocado, taxa: aloc.taxaInvoice }]`. Nesse
caminho `Σ titulos.usd === valorAlocado` **por construção** — mas ele é sintético, não uma medida do
ERP. A pré-checagem tem que ser explicitamente inaplicável aqui: se disparar, quebra a maioria do
volume em produção.

### C-3 · O campo que responde "em aberto" **existe e já é buscado** — e é BRL

`titMnyTotPago` já está no `fieldList` do client e já é mapeado para `TituloAPagar.valorPago`
(`ConexosTitulosClient.ts:275,283`). **`executarBaixa:380` simplesmente não o usa** — mapeia só
`{titCod, usd: t.valorNegociado, taxa: t.taxa}`.

Wrinkle de grandeza que impede um "subtrai e pronto": **`valorNegociado` é moeda negociada
(`titMnyValorMneg`) e `valorPago` é BRL (`titMnyTotPago`)**. O aberto em moeda negociada só sai por
derivação — `valorNegociado − valorPago / taxa` — e o swagger de `FinTituloFin` **não tem**
`titMnyAberto` (esse campo só existe em `FinTituloCartAgr`). O precedente do repo para essa
derivação é `derivarPagoDosTitulos` (`EleicaoPermutasService.ts:103-112`).

Isso é decisão de domínio com efeito monetário, não escolha de implementação ⇒ **Task 14 (P0)**.

### C-4 · A rota `/reconciliar` hoje transforma qualquer `HandlerError` em **HTTP 500**

`routes/permutas.ts:489-512` chama `service.reconciliar` dentro do `asyncHandler` **sem** try/catch e
**sem** `respondHandlerError`. O `errorMiddleware.ts` global responde `500 {error: 'Internal server
error'}` e **descarta** `statusCode`, `code`, `userMessage` e `retryable`. Ou seja: implementar o 409
e o 422 no serviço **não basta** — sem a Task 6 os dois chegam ao analista como "erro interno", e o
`userMessage` em PT (a razão de existir das duas classes de erro) morre no meio do caminho. O
precedente correto está em `routes/sispag.ts:428-449` (try/catch + `respondLoteError`) e
`routes/recebimentos.ts:740` (`respondHandlerError`).

### C-5 · Colisão de nome: `parcial` já existe, com **outro** significado

`ReconciliacaoLotePermutaService.ts:17` — `LoteAdiantamentoStatus = 'settled' | 'parcial' | 'error' |
'dry-run' | 'skipped'`, onde `parcial` significa *"alguns pares do adto deram settled, outros deram
error"* (`statusDoAdto:183`). O `parcial` novo é **status de execução de UM par** e significa *"a
baixa deste par cobriu o alocado só em parte"*. Os dois vão coexistir no mesmo módulo e são
espelhados no frontend (`types.ts:279`). Não unificar, não reusar: nomear e testar a distinção.

### C-6 · O badge do frontend tem um `else` que engole estado novo

`ui.tsx:118-133` — `PermutaBorderoBadge` testa `=== 'finalizado'` e **cai no else** para todo o
resto, renderizando "Aguardando finalização". Acrescentar `parcial-aguardando-finalizacao` só ao
**tipo** faz o novo estado ser exibido como se fosse o antigo — exatamente o "`parcial` vira o novo
silêncio" que a ADR-0044 nomeia como o risco que ela mesma cria. O `typecheck` **não** pega isso (o
`else` continua válido).

### C-7 · O construtor do serviço é injetado posicionalmente nos testes

`ReconciliacaoPermutaService.test.ts:89-99` monta o serviço com 9 argumentos posicionais
(`as never`). Acrescentar `PostgreeDatabaseClient` ao construtor **quebra o builder de todos os 23
testes existentes** se a posição for escolhida no meio. Acrescentar no fim e atualizar `buildDeps`.

### C-8 · A "idempotência viva" só conhece `settled` — e a ontologia não decidiu o caso `parcial`

`ReconciliacaoPermutaService.ts:176` — `if (existente?.status === 'settled')` é o gate que consulta
`borderoAindaValido` e, quando o borderô foi CANCELADO/ESTORNADO/REMOVIDO no ERP, faz `renameKey` e
**libera o relançamento** (a baixa foi anulada; a permuta volta a ser lançável).

Com `parcial` terminal, esse gate deixa um **buraco que a ADR-0044 não endereça**: se o borderô de
uma execução `parcial` for cancelado no ERP, `:176` não casa, o fluxo cai direto no
`beginExecution` — que devolverá `alreadySettled: true` (Task 2) — e o par fica **bloqueado para
sempre** sob aquela chave. Ao mesmo tempo, **B3** manda a máquina de badge devolver o adto a
`PENDENTE` ("nenhum borderô válido sobra ⇒ reabre"). Os dois lados discordariam: a tela diria
"pendente, pode lançar" e o ledger recusaria silenciosamente com `skipped`.

**Resolução proposta (simetria, custo ~1 linha):** o gate passa a valer para os **dois** terminais —
`existente?.status === 'settled' || existente?.status === 'parcial'`. O critério do `renameKey` já é
"a escrita irreversível ainda vale no ERP?", e num borderô cancelado ela não vale, em `settled` ou em
`parcial`. Isso **não** afrouxa I-Recon-1: com o borderô vivo, `parcial` segue preservado e pulado,
que é o que a ontologia exige ("o dinheiro já se moveu").

**Isto não está escrito na ontologia.** Está coberto pela Task 10 como decisão de implementação e
registrado na Task 13 para o `OntologyCurator` incorporar (ou recusar). Se a resposta do Yuri for
outra, é uma pergunta P0 de `InfoGapBroker`, não um detalhe de código.

---

## Task list

### Task 1: Testes falhando — trilha aceita o terminal `parcial`

**Files to change:**
- `src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts`

**Acceptance criteria:**
- [ ] Teste `markParcial grava status=parcial + valor_residual_usd + bxa_cod_seq` — assert no SQL
      montado (mesmo estilo dos testes já existentes no arquivo) e nos params nomeados
- [ ] Teste `beginExecution preserva parcial (não regride para reconciling)` — `db.selectFirst`
      devolve `{status:'parcial'}` ⇒ `alreadySettled === true`
- [ ] O teste existente `beginExecution: UPSERT que PRESERVA settled` (`:22`) é **atualizado, não
      duplicado**: ele hoje faz `expect(sql).toContain("permuta_alocacao_execucao.status =
      'settled'")` (`:40`), asserção que **quebra** assim que a CASE vira `IN ('settled','parcial')`.
      Passa a assertar a forma nova e a cobrir os dois terminais. É a única quebra mecânica
      **garantida** deste delta — resolvida aqui, de propósito, e não descoberta no meio da Task 2
- [ ] Teste `mapRow devolve valorResidualUsd quando a coluna vem preenchida` e **omite** o campo
      quando `null` (o repo usa spread condicional em `mapRow:461-478`, não `undefined` explícito —
      CLAUDE.md, "Optional: `property?: Type`")
- [ ] `cd src/backend && npx jest domain/repository/permutas/PermutaExecucaoRepository.test.ts`
      **falha**, e falha por ausência de `markParcial`/`valorResidualUsd` — não por erro de mock

**Dependencies:** none

---

### Task 2: Migration `0056` + `ExecucaoStatus` + `markParcial` no repositório

**Files to change:**
- `src/backend/migrations/0056_permuta_execucao_parcial.sql` (novo)
- `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts`

**Acceptance criteria:**
- [ ] Migration idempotente (padrão do diretório): `ALTER TABLE permuta_alocacao_execucao DROP
      CONSTRAINT IF EXISTS ...` + `ADD CONSTRAINT ... CHECK (status IN
      ('pending','reconciling','settled','error','parcial'))` e `ADD COLUMN IF NOT EXISTS
      valor_residual_usd NUMERIC`
- [ ] O nome do CHECK criado em `0015_permuta_alocacao_execucao.sql:20` é resolvido de fato (o CHECK
      lá é **inline**, sem nome explícito ⇒ o nome gerado pelo Postgres é
      `permuta_alocacao_execucao_status_check`); a migration não pode assumir um nome que não existe
      — se o `DROP CONSTRAINT` errar o nome, o CHECK antigo permanece e o `INSERT` de `parcial`
      falha **em runtime**, não no deploy
- [ ] Rodar a migration duas vezes seguidas é no-op na segunda (idempotência — convenção do diretório)
- [ ] `ExecucaoStatus:5` passa a `'pending' | 'reconciling' | 'settled' | 'error' | 'parcial'`
- [ ] `markParcial` existe como **método irmão** de `markSettled` (não um parâmetro a mais): grava
      `status='parcial'`, `valor_residual_usd`, `bor_cod`, `bxa_cod_seq`, `valor_baixado`, `juros`,
      `conta_juros`, `erp_response`, e o mesmo `COALESCE` de identidade Conexos do `markSettled:309-311`
- [ ] `beginExecution:236-249` — **todas as 5** CASEs do `ON CONFLICT DO UPDATE` (`status`, `dry_run`,
      `executado_por`, `conexos_username`, `conexos_usn_cod`) passam a testar
      `IN ('settled','parcial')`; `BeginExecutionResult.alreadySettled` fica `true` para os dois
- [ ] `valor_residual_usd` acrescentado às **5** listas de colunas de SELECT do arquivo —
      `findByIdempotencyKey:73`, `listByAdiantamento:85`, `listComBordero:131`,
      `findByBorCodInvoice:147`, `listByBorCod:173` — senão o campo existe no banco e nunca chega ao
      endpoint (I-Recon-7(b) depende disso)
- [ ] SQL 100% parametrizado (`$nome`), zero interpolação — Inviolable Rule #5
- [ ] `cd src/backend && npx jest domain/repository/permutas/PermutaExecucaoRepository.test.ts` ✅
- [ ] `cd src/backend && npm run typecheck` ✅

**Dependencies:** Task 1

---

### Task 3: Paridade dos tipos espelhados à mão (backend ↔ frontend)

**Files to change:**
- `src/frontend/lib/types.ts`
- `src/frontend/lib/types.test.ts` (novo, se não existir)

**Acceptance criteria:**
- [ ] `ExecucaoStatus:255` ganha `'parcial'` (espelha `PermutaExecucaoRepository.ts:5`)
- [ ] `PermutaStatusBordero:319` ganha `'parcial-aguardando-finalizacao'` (espelha `PermutaStatus`
      em `BorderoGestaoService.ts:21`) — **este não estava no handoff original e é obrigatório para a
      Task 11**
- [ ] `ExecucaoPermuta:302` ganha `valorResidualUsd?: number` (é o campo que a UI da trilha precisa
      para I-Recon-7(b))
- [ ] Teste de paridade que **falha quando alguém acrescenta um estado só de um lado**: lista literal
      dos valores esperados nas duas uniões, comparada contra uma constante espelhada no arquivo de
      teste, com um comentário apontando os dois `file:line` de origem. Nada força a paridade no
      compilador (os projetos são separados) — o teste é a única guarda possível
- [ ] `cd src/frontend && npm run typecheck` ✅ e `npm test` ✅

**Dependencies:** Task 2

---

### Task 4: Testes falhando — serialização de `reconciliar` por adiantamento (I-Recon-5 / T3)

**Files to change:**
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts`

**Acceptance criteria:**
- [ ] `buildDeps` ganha um mock de `PostgreeDatabaseClient` com `withAdvisoryLock` **de verdade**:
      um `Set<number>` de chaves em voo, `onAcquired` quando entra, `onBusy` quando a chave já está
      tomada, liberando no `finally` — um mock que sempre chama `onAcquired` torna o teste de
      concorrência decorativo
- [ ] Teste `serializa dois POSTs concorrentes para o mesmo adto`:
      `await Promise.allSettled([service.reconciliar(A), service.reconciliar(A)])` com
      `conexosWriteEnabled=true, conexosDryRun=false` ⇒
      `conexosClient.gravarBaixaPermuta.mock.calls.length === 1` **e**
      `conexosClient.criarBordero.mock.calls.length === 1` (o borderô é o outro artefato duplicado
      pelo R-1 — assertar só a baixa deixaria passar o borderô órfão)
- [ ] Mesmo teste: a promessa perdedora rejeita com `ReconciliacaoEmAndamentoError`, e
      `err.statusCode === 409`, `err.retryable === true`, `err.code === 'RECONCILIACAO_EM_ANDAMENTO'`
- [ ] Teste `adiantamentos distintos NÃO se bloqueiam`: `Promise.all([reconciliar(A),
      reconciliar(B)])` ⇒ ambas resolvem, `gravarBaixaPermuta` chamada 2×
- [ ] Teste `o caller barrado não toca o ERP`: nas chamadas da promessa perdedora,
      `criarBordero`, `validarTituloBaixa`, `validarTituloPermuta` e `gravarBaixaPermuta` somam zero
      invocações atribuíveis a ela (verificável pela contagem total = 1 execução)
- [ ] Os 23 testes existentes do arquivo continuam verdes após a mudança do `buildDeps`
- [ ] `cd src/backend && npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts`
      **falha** nos testes novos

**Dependencies:** Task 2

---

### Task 5: `ReconciliacaoEmAndamentoError` + advisory lock em `reconciliar` (I-Recon-5 / R-1, P0)

**Files to change:**
- `src/backend/domain/errors/ReconciliacaoEmAndamentoError.ts` (novo)
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts`

**Acceptance criteria:**
- [ ] `ReconciliacaoEmAndamentoError implements HandlerError` com `code =
      'RECONCILIACAO_EM_ANDAMENTO'`, `statusCode = 409`, `retryable = true`, `userMessage` **em
      português** dizendo o que fazer (esperar e recarregar) e o que aconteceria se clicasse de novo
      (dois borderôs e duas baixas no Conexos) — espelha `RemessaEmAndamentoError.ts:28-33`.
      Identificador em inglês, mensagem ao operador em PT (CLAUDE.md, seção Language)
- [ ] `reconciliar` vira o wrapper: `this.db.withAdvisoryLock(this.chaveDeLock(adiantamentoDocCod),
      () => this.reconciliarSerializado(input), onBusy)`; o corpo atual (`:100-296`) move **inteiro**
      para `reconciliarSerializado`, sem outra mudança de comportamento nesta task
- [ ] `chaveDeLock` é hash int32 estável — mesma técnica de `RemessaService.ts:147-153`
      (`Math.imul(31, h) + charCodeAt(i) | 0`). Docblock registra que colisão custa serialização
      desnecessária, **nunca** corretude
- [ ] `onBusy` emite `LogService.warn` `BUSINESS_WARN` (adto + executadoPor) **antes** de lançar —
      espelha `RemessaService.ts:135-142`
- [ ] `PostgreeDatabaseClient` injetado via `@inject(...)` no **fim** da lista do construtor (C-7)
- [ ] `EnvironmentProvider` continua sendo a única fonte de config; zero `process.env` no serviço
      (Inviolable Rule #8)
- [ ] `cd src/backend && npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts` ✅
      (incluindo os 4 testes da Task 4)
- [ ] `cd src/backend && npm run typecheck && npm run lint` ✅

**Dependencies:** Task 4

---

### Task 6: A rota `/reconciliar` passa a devolver 409/422 de verdade (C-4)

**Files to change:**
- `src/backend/routes/permutas.ts`
- `src/backend/routes/permutas.test.ts` (ou o arquivo de teste de rota equivalente; criar se não houver)
- `src/frontend/lib/api.ts`

**Acceptance criteria:**
- [ ] `POST /permutas/adiantamentos/:docCod/reconciliar` (`:489-511`) envolve a chamada em try/catch
      e delega a `respondHandlerError(req, res, err)`; o que não for `HandlerError` continua subindo
      para o `errorMiddleware` (`if (!respondHandlerError(...)) throw err;`) — precedente:
      `routes/recebimentos.ts:740`
- [ ] Teste de rota: `service.reconciliar` rejeita com `ReconciliacaoEmAndamentoError` ⇒ resposta
      **409** com `code`, `userMessage` e `retryable: true` no corpo — **não** `500 {error:
      'Internal server error'}`
- [ ] Teste de rota: rejeita com `AlocacaoSemCoberturaError` ⇒ **422** com `userMessage`
- [ ] Teste de rota: um `Error` cru continua virando **500** genérico (regressão de
      `security-3`/F-security-5: nada de `err.message` vazando ao cliente)
- [ ] `reconciliarAdiantamento` (`src/frontend/lib/api.ts:247`) exibe o `userMessage` do corpo de
      erro quando presente, em vez do texto genérico — o 409 é acionável pelo analista ("aguarde"),
      e um toast genérico desperdiça a informação
- [ ] `cd src/backend && npm test` ✅ · `cd src/frontend && npm run typecheck` ✅

**Dependencies:** Task 5

---

### Task 7: Testes falhando — pré-checagem de cobertura (I-Write-8a), **com os dois não-disparos**

**Files to change:**
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts`

**Acceptance criteria:**
- [ ] Teste `aborta antes do 1º POST quando Σ titulos.usd < valorAlocado`:
      `listTitulosAPagar` devolve `[{titCod:1, usd:600, taxa:5}, {titCod:2, usd:300, taxa:5}]` (Σ=900)
      contra `valorAlocado=1000` ⇒ resultado do par é `error` com `AlocacaoSemCoberturaError`
      (`statusCode 422`), **e** `gravarBaixaPermuta` **nunca** é chamada (0 invocações), **e**
      `markSettled`/`markParcial` **nunca** são chamados
- [ ] Mesmo teste: o borderô criado nessa chamada é removido pela limpeza I-Write-7 já existente
      (`excluirBordero` chamada) — abortar não pode deixar casco vazio no ERP
- [ ] **Não-disparo 1 (C-2)** — teste `NÃO aborta no fallback de título único`:
      `listTitulosAPagar` devolve `[]` (e outro caso: `mockRejectedValue`) ⇒ o fallback
      `[{titCod:1, usd: valorAlocado}]` roda, `gravarBaixaPermuta` **é** chamada 1×, status `settled`.
      Este é o caminho majoritário em produção — se ele abortar, o tweak quebra mais do que conserta
- [ ] **Não-disparo 2 (C-1b)** — teste `NÃO aborta quando a lista veio truncada`: a lista devolvida
      é **incompleta segundo o `count` do envelope** (`rows.length !== count`) e sua soma é menor que
      `valorAlocado` ⇒ **não** lança `AlocacaoSemCoberturaError`; a execução segue, distribui o que
      dá, e termina em **`parcial`** (caminho 8b) — nunca `settled`, nunca 422.
      **O critério é `rows.length !== count`, não `rows.length === 100`**: o ERP impõe a própria
      página (medido em HML: pedimos 500, veio 50 com `count: 86` —
      `ConexosGerDocProcessoClient.ts:928-931`), então 100 é um número inventado por nós
- [ ] Teste `lista completa (rows.length === count) com soma insuficiente ⇒ aborta 422` — o
      complemento do anterior; sem ele a guarda de truncamento poderia desligar 8a sempre e o teste
      acima passaria de graça
- [ ] Teste de fronteira: `Σ titulos.usd === valorAlocado − 0.004` (dentro da tolerância de 0,005)
      ⇒ **não** aborta; `−0.006` ⇒ aborta. A tolerância é 0,005 na **moeda negociada**, e é distinta
      da tolerância dinâmica anti-drift de `:269` (`Math.max(0.01, emAbertoErp*0.005)`, em BRL, por
      título) — o teste deixa a distinção explícita em comentário
- [ ] Teste da fórmula decidida na **Task 14**: um título `ATIVO e já quitado` (face 500, pago 500)
      **não** contribui para a cobertura. Hoje contribuiria com 500 cheios (C-1a) — este é o teste
      que prova que a decisão de domínio foi aplicada, e ele só pode ser escrito depois dela
- [ ] `cd src/backend && npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts -t
      "cobertura"` **falha**

**Dependencies:** Task 5, **Task 14 (P0 — bloqueante)**

---

### Task 8: `AlocacaoSemCoberturaError` + pré-checagem fail-closed (I-Write-8a / R-2 previsível)

**Files to change:**
- `src/backend/domain/errors/AlocacaoSemCoberturaError.ts` (novo)
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts`

**Acceptance criteria:**
- [ ] `AlocacaoSemCoberturaError implements HandlerError`: `code = 'ALOCACAO_SEM_COBERTURA'`,
      `statusCode = 422`, `retryable = false`, `details = { adiantamentoDocCod, invoiceDocCod,
      somaTitulos, valorAlocado, deficit }`, `userMessage` em PT explicando que os títulos em aberto
      da invoice **não cobrem** o valor alocado e que a saída é re-alocar. Docblock diz que é o
      **irmão-déficit** do `AlocacaoSaldoError` (que barra o excesso) e cita I-Write-8a
- [ ] A checagem roda em `executarBaixa`, **depois** da montagem de `titulos` e **antes** da primeira
      chamada a `baixarTitulo` — nenhuma escrita no ERP a precede
- [ ] A checagem é **pulada** quando os títulos vieram do fallback (lista vazia/`catch`): a origem
      dos títulos é rastreada explicitamente (ex.: um `titulosDoErp: boolean`), **não** inferida por
      `titulos.length === 1` — uma invoice real de título único é indistinguível do fallback por
      contagem, e confundir os dois desliga a guarda no caso legítimo
- [ ] `listTitulosAPagar` passa a **preservar o `count`** do envelope do ERP (hoje descartado por
      `legacyConexosAdapter.listGeneric`, que devolve `rows ?? data`). Sem isso o truncamento é
      indetectável e a guarda abaixo não tem como existir. Precedente pronto no mesmo arquivo:
      `listBaixasTitulo:307` usa `base.paginate` (com `MAX_PAGES`, parada por `count` e callback
      `onCapHit` para `BUSINESS_WARN`) — preferir `paginate` a inventar contagem nova
- [ ] A checagem é **pulada** quando `rows.length !== count` (truncamento — C-1b): a soma não é
      confiável, 8a não se aplica, o caso cai em 8b. Emite `BUSINESS_WARN` registrando a omissão com
      `docCod`, `rows.length` e `count` — sem esse log a omissão é invisível
- [ ] A fórmula da cobertura é a decidida na **Task 14** (face vs. aberto), não `Σ valorNegociado`
      cru. Se a decisão for subtrair o pago, lembrar da conversão de grandeza: `valorPago` é **BRL**
      (`titMnyTotPago`) e `valorNegociado` é **moeda negociada** (`titMnyValorMneg`) — C-3
- [ ] Comentário no código nomeia C-1/C-2/C-3, cita o enum do swagger
      (`docs/conexos-api/070-com3.json`, `FinTituloFin.titVldStatus = ATIVO|RENEGOCIADO|CANCELADO`)
      e o motivo de cada guarda — a próxima pessoa que ler `if (!titulosDoErp) return;` precisa saber
      que não é preguiça, e a que ler o filtro `titVldStatus#EQ:'1'` precisa saber que ele **não**
      significa "em aberto"
- [ ] O erro **não** derruba o lote: `ReconciliacaoLotePermutaService` continua no `continue-on-error`
      (`:136-148`), contabiliza 1 erro e segue para o próximo adto
- [ ] `cd src/backend && npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts` ✅
- [ ] `cd src/backend && npm run typecheck && npm run lint` ✅

**Dependencies:** Task 7, **Task 14 (P0 — bloqueante)**

---

### Task 9: Testes falhando — terminal `parcial` (I-Recon-6/7 + I-Write-8b / R-2 imprevisível)

**Files to change:**
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts`

**Acceptance criteria:**
- [ ] Teste `Σ titulos.usd < valorAlocado detectado APÓS o 1º POST ⇒ parcial com resíduo, nunca
      settled`: cenário em que a pré-checagem não se aplica (lista de 100 — C-1) e o laço esgota os
      títulos com `restanteUsd > 0.005` ⇒ `markParcial` chamada **1×** com
      `valorResidualUsd === restanteUsd`, `markSettled` chamada **0×**
- [ ] Teste `o resultado do par carrega status 'parcial'` — `ResultadoAlocacao.status === 'parcial'`
      e `valorResidualUsd` presente (é o que alimenta `GET /execucoes`, I-Recon-7(b))
- [ ] Teste `parcial emite BUSINESS_WARN com os 4 campos` — `logService.warn` chamado com
      `type: LOG_TYPE.BUSINESS_WARN` e `data` contendo `adiantamentoDocCod`, `invoiceDocCod`,
      `borCod` e `valorResidualUsd` (I-Recon-7(a) enumera exatamente esses quatro)
- [ ] Teste `parcial é preservado na re-execução (mesma chave)` — `beginExecution` devolve
      `{status:'parcial', alreadySettled:true}` ⇒ o par é `skipped`, `gravarBaixaPermuta` 0×.
      O dinheiro já se moveu; re-POSTar é super-pagamento
- [ ] Teste `parcial NÃO é apagado pela limpeza do borderô órfão (I-Write-7)`: um par `parcial`
      **conta** como baixa confirmada ⇒ `excluirBordero` **não** é chamada. Hoje
      `isBaixaConfirmada:40` testa `r.status === 'settled'` — sem ajuste, uma execução `parcial`
      sozinha faria a limpeza apagar do ERP um borderô **que tem baixa real dentro**. (A limpeza é
      fail-safe via `listBaixas`, mas depender disso é depender de um catch)
- [ ] Teste de regressão do lote: `ReconciliacaoLotePermutaService.test.ts` — um par `parcial` não é
      contado como `settled` nem como `error` nos totais, e o `LoteAdiantamentoStatus` resultante é
      distinguível (C-5: o `parcial` do lote é outra coisa)
- [ ] `cd src/backend && npx jest domain/service/permutas` **falha** nos testes novos

**Dependencies:** Task 8

---

### Task 10: `markParcial` no fluxo de baixa + WARN + propagação (I-Recon-6/7, I-Write-8b)

**Files to change:**
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts`
- `src/backend/domain/service/permutas/ReconciliacaoLotePermutaService.ts`

**Acceptance criteria:**
- [ ] Ao fim do laço de `executarBaixa` (`:440` hoje `markSettled` incondicional): se
      `restanteUsd > 0.005` ⇒ `markParcial(key, { ..., valorResidualUsd: restanteUsd })`; senão
      `markSettled` como hoje. Nenhum caminho grava `settled` com resíduo, e nenhum grava `error`
      sobre baixas já POSTadas
- [ ] `ResultadoAlocacao.status` aceita `'parcial'` (a união já é `ExecucaoStatus | 'dry-run' |
      'skipped'`, então herda da Task 2) e o retorno de `executarBaixa` carrega `valorResidualUsd?`
- [ ] `BUSINESS_WARN` no caminho `parcial` (não `info`): a distinção importa porque é o WARN que o
      detector proativo e a busca em log usam
- [ ] `isBaixaConfirmada:40` passa a `r.status === 'settled' || r.status === 'parcial'`, com o
      docblock atualizado — o critério é "pôs item no borderô?", e `parcial` pôs
- [ ] **C-8** — o gate de idempotência viva (`:176`) passa a valer para os dois terminais
      (`'settled' || 'parcial'`), de modo que um borderô `parcial` CANCELADO/ESTORNADO/REMOVIDO no
      ERP libere o relançamento por `renameKey`, como já acontece com `settled`
- [ ] Teste `parcial + borderô cancelado no ERP ⇒ relançável`: `getBordero` devolve
      `{borVldFinalizado: 2}` ⇒ `renameKey` chamada com o sufixo `:sup:{borCod}` e
      `gravarBaixaPermuta` **é** chamada. Sem este teste, o ledger e a máquina B3 divergem em
      silêncio (a tela diz "pendente", o ledger devolve `skipped`)
- [ ] Teste `parcial + borderô VIVO ⇒ skipped`: `getBordero` devolve `{borVldFinalizado: 0}` ⇒
      `gravarBaixaPermuta` **0×** (I-Recon-1 preservado — o dinheiro já se moveu)
- [ ] `ReconciliacaoLotePermutaService`: contadores (`:126-129`) e `statusDoAdto:177-187` tratam
      `parcial` de par explicitamente; **não** reusar nem colidir com o `LoteAdiantamentoStatus
      = 'parcial'` já existente (C-5) — o docblock nomeia a diferença
- [ ] `GET /permutas/adiantamentos/:docCod/execucoes` devolve as linhas `parcial` **com**
      `valorResidualUsd` (I-Recon-7(b)) — verificável com um teste de rota ou pelo teste do repo da
      Task 2 somado ao passthrough de `routes/permutas.ts:750-759`
- [ ] `cd src/backend && npm test` ✅ · `npm run typecheck` ✅ · `npm run lint` ✅

**Dependencies:** Task 9

---

### Task 11: B1' — `parcial-aguardando-finalizacao` no painel, sem sair da fila de elegibilidade

**Files to change:**
- `src/backend/domain/service/permutas/BorderoGestaoService.ts`
- `src/backend/domain/service/permutas/BorderoGestaoService.test.ts`
- `src/frontend/app/permutas/components/ui.tsx`
- `src/frontend/__tests__/permutas-components.test.tsx` (hoje **não** cobre `PermutaBorderoBadge` —
  grep por ele volta vazio; o badge é o ponto exato onde o estado novo pode ser engolido, C-6)

**Acceptance criteria:**
- [ ] `PermutaStatus:21` passa a `'aguardando-finalizacao' | 'parcial-aguardando-finalizacao' |
      'finalizado'`
- [ ] `statusPorAdiantamento` — o filtro `r.status !== 'settled'` (`:495` — a ontologia cita `:493`; medido hoje é `:495`) passa a aceitar os **dois**
      terminais; a agregação guarda, por adto+borCod, se **alguma** execução terminal é `parcial`
- [ ] Mapeamento: borderô `EM_CADASTRO` + todas as execuções terminais `settled` ⇒
      `aguardando-finalizacao`; **ao menos uma** `parcial` ⇒ `parcial-aguardando-finalizacao`;
      `FINALIZADO` ⇒ `finalizado` (o seam nomeado na ADR-0044 — a máquina responde sobre o
      **borderô**, e ele está concluído; o resíduo segue com o ledger)
- [ ] **Requisito duro (a armadilha nomeada na ADR-0044):** teste que prova que o adiantamento com
      execução `parcial` **continua na fila de elegibilidade** — nenhum consumidor de
      `statusPorAdiantamento` o remove de "pendentes"/elegíveis. Este badge é **sobre o borderô** e
      **nunca** input de elegibilidade; se falhar, o defeito do R-2 apenas mudou de lugar
- [ ] Teste: adto com `parcial` **e** `settled` no mesmo borderô ⇒ `parcial-aguardando-finalizacao`
      (o resíduo é a informação que não pode se perder na agregação)
- [ ] Teste: borderô CANCELADO/ESTORNADO/REMOVIDO ⇒ adto **omitido** do mapa ⇒ volta a `pendente`
      (B3 continua valendo para o estado novo)
- [ ] **C-6** — `PermutaBorderoBadge` (`ui.tsx:118`) ganha um ramo **próprio** para
      `parcial-aguardando-finalizacao`, visualmente distinto de "Aguardando finalização", exibindo o
      borderô **e** dizendo que há resíduo a re-alocar. Um `switch`/`if` explícito sobre os três
      valores, sem `else` guarda-chuva — o `else` atual renderizaria o estado novo como o antigo e o
      `typecheck` não pegaria
- [ ] `cd src/backend && npx jest domain/service/permutas/BorderoGestaoService.test.ts` ✅
- [ ] Teste de render do badge para os **três** valores + o `undefined` (pendente), cada um
      assertando texto distinto — é a única guarda contra C-6, já que o `typecheck` não pega o `else`
- [ ] `cd src/frontend && npm run typecheck && npm run lint && npm test` ✅
- [ ] `DesignSystemReviewer` gate ✅ (tokens `warning`/`danger` do design system, não cor crua)

**Dependencies:** Task 3, Task 10

---

### Task 12: Cobrir `borderoAindaValido` 5/5 ramos (T2 — `testability-4`)

**Files to change:**
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts`

**Acceptance criteria:**
- [ ] `borderoAindaValido` (`:811-822`) tem os **5** ramos exercitados, cada um assertando se
      `gravarBaixaPermuta` é ou não chamada:
      `borCod === undefined` ⇒ libera · `getBordero → null` (removido) ⇒ libera ·
      `{borCodEstornado: 999}` ⇒ libera · `{borVldFinalizado: 2}` (cancelado) ⇒ libera ·
      `getBordero` rejeita (`ETIMEDOUT`) ⇒ **bloqueia** (catch conservador)
- [ ] O teste do catch conservador tem comentário dizendo por que "incerto ⇒ bloqueia" é a escolha
      certa (re-baixar sob incerteza é super-pagamento) — é o ramo que aparece em incidente e o
      primeiro que alguém "otimizaria" ao contrário
- [ ] `cd src/backend && npx jest domain/service/permutas/ReconciliacaoPermutaService.test.ts` ✅
- [ ] Nenhuma mudança em código de produção nesta task

**Dependencies:** Task 5

---

### Task 13: Fechar a defasagem ontologia × código (runbook + coverage)

**Files to change:**
- `docs/runbooks/fin010-write-cutover.md`
- `ontology/_coverage.json`
- `ontology/_index.json`
- `ontology/_inbox/permutas-baixa-integridade-followups.md`

**Acceptance criteria:**
- [ ] O runbook tem **três** pontos com a ressalva "ainda não em produção", não um; todos os três
      saem/viram afirmação positiva. Medidos hoje em `docs/runbooks/fin010-write-cutover.md`:
      (i) `:40-45` — o parágrafo "Mudança decidida (ADR-0044), ainda não em produção" dentro de
      *Rollback*, incluindo a frase final "Até isso entrar, o resíduo continua chegando como
      `settled` mudo";
      (ii) `:52-54` — o `*(ADR-0044, ainda não em produção)*` do bullet **409
      `RECONCILIACAO_EM_ANDAMENTO`** em *Sinais de problema*;
      (iii) `:65-76` — a seção inteira **"Invariantes decididos (ADR-0044) e AINDA NÃO no código"**,
      cujos dois bullets (I-Recon-5 e I-Write-8) declaram os buracos abertos e prescrevem mitigação
      manual ("combinar quem reconcilia qual adto antes de rodar")
- [ ] Os invariantes migrados para a seção **"Invariantes que o código já garante"** (`:58-64`),
      com a mesma precisão dos que já estão lá. Esta é a única task cujo critério central é a
      **remoção** de afirmações: enquanto elas estiverem lá, o runbook manda o analista fazer
      trabalho manual que o código já faz — e o custo de um runbook desatualizado é alguém confiar
      nele
- [ ] `_coverage.json`: `Permuta.impl_pct` volta de **85** para **90** (o recuo de propósito registrado
      na ADR-0044 se paga aqui, não antes)
- [ ] `_index.json`: os arquivos novos (`0056_permuta_execucao_parcial.sql`,
      `ReconciliacaoEmAndamentoError.ts`, `AlocacaoSemCoberturaError.ts`) **já estão** em
      `business_rules['idempotencia-reconciliacao'].impl_files` — o curator os escreveu
      antecipadamente. O que muda aqui é o `status`, hoje `"partial"`. Idem para
      `fin010-write-contract` e `state_machines['status-permuta-bordero']`. Conferir arquivo por
      arquivo antes de virar o status: um `impl_files` que aponta para arquivo inexistente é pior
      que um índice incompleto
- [ ] O item 5 do `permutas-baixa-integridade-followups.md` ("Riscos abertos em produção ATÉ a
      implementação entrar") é atualizado: R-1 e R-2 fechados, com o **PR** que os fechou. Os itens
      1, 2 e 3 (re-alocação, âncoras stale, contagem de business-rules) **permanecem abertos** — não
      foram feitos e não devem parecer feitos
- [ ] Registrar explicitamente que **I-Recon-7(c) segue não cumprido** (ver abaixo) — não marcar o
      invariante como implementado
- [ ] **C-8** incorporado a `idempotencia-reconciliacao.md`: a cláusula da "idempotência viva"
      (variante `"{key}:sup:{borCod}"`) passa a dizer explicitamente que vale para `settled` **e**
      `parcial`. Hoje o documento só fala de `settled`, e o diagrama da máquina não cobre
      `parcial + borderô cancelado`
- [ ] `git diff` desta task não toca **nenhum** arquivo em `src/`

**Dependencies:** Task 11, Task 12

---

### Task 14: [P0 — BLOQUEANTE] Fechar a pergunta de domínio que a ADR-0044 não sabia que tinha

> **Esta task existe porque o scoping refutou uma premissa da ADR-0044, não porque o código está
> errado em relação a ela.** A ADR foi escrita assumindo que os títulos lidos eram "os títulos em
> aberto da invoice". Não são (C-1a). Implementar 8a sobre a premissa antiga produz um gate
> fail-closed que quase nunca fecha — e que *parece* funcionar, porque todo teste que escrevêssemos
> herdaria a mesma premissa. Por isso ela bloqueia as Tasks 7 e 8, e por isso não se resolve
> adivinhando.

**Files to change:**
- `ontology/_inbox/permutas-baixa-integridade-gt-gap.md` (novo — via `InfoGapBroker`)
- `docs/conexos-api/screens/com311.md`
- `ontology/integrations/conexos.md`

**Acceptance criteria:**
- [ ] **P0 ao Yuri (`InfoGapBroker`), com as três opções já instrumentadas:** a cobertura de
      I-Write-8a deve ser **(i)** `Σ valorNegociado` (face — comportamento de hoje, mais frouxo),
      **(ii)** `Σ (valorNegociado − valorPago/taxa)` (aberto derivado — o que a ADR-0044 descreve em
      palavras), ou **(iii)** manter a face e trocar o filtro para incluir `pago#NE: 1`?
      A pergunta carrega o enum verificado e o impacto medido, não só o dilema
- [ ] Sub-pergunta explícita: um título **RENEGOCIADO (2)** ou **CANCELADO (3)** com saldo aberto
      deve contar para a cobertura? O filtro atual os exclui **por acidente de premissa**, não por
      decisão registrada
- [ ] `docs/conexos-api/screens/com311.md:46` corrigido — hoje afirma
      `titVldStatus (aberto/pago/permutado)`, que **contradiz o swagger**. O arquivo está marcado
      `status: seed` / "a confirmar"; corrigir citando o schema `FinTituloFin` de
      `docs/conexos-api/070-com3.json`. Uma doc errada sobre o campo que decide dinheiro é como a
      premissa entrou na ADR
- [ ] `ontology/integrations/conexos.md` — o gap **`com308-enum-pago (P3)`** é fechado **offline**,
      citando o enum do swagger (`1 TOTALMENTE PAGO / 2 PARCIALMENTE PAGO / 3 NÃO PAGO`). Estava
      marcado como "decodificar em sonda futura"; a resposta estava versionada no repo o tempo todo.
      Fecha junto o card `integrability-7` do Regis-Review — **sem sonda, sem custo**
- [ ] A resposta do Yuri vira uma linha em `fin010-write-contract.md` (I-Write-8a ganha a definição
      **explícita** de "cobertura"), aplicada pelo `OntologyCurator`. Hoje o invariante diz
      `Σ(titulos.usd)` sem dizer que grandeza é essa — a ambiguidade que produziu esta task
- [ ] Nenhuma linha de `src/` muda nesta task

**Dependencies:** none (é a primeira coisa a rodar — as Tasks 7 e 8 esperam por ela)

---

## Invariante parcialmente cumprido — registrar, não esconder

**I-Recon-7(c)** exige que `parcial` seja *"alvo elegível do detector proativo da trilha de permutas,
na mesma classe de `reconciling` preso"*. Medido neste worktree: **não existe reaper de permutas**.
O único detector é `src/backend/jobs/reaper-sispag-reconciling.ts`, restrito a SISPAG (remessa e
conciliação). O detector de permutas é o card `cc-reaper-permutas` do mesmo Regis-Review — **fora do
escopo deste tweak por instrução explícita**.

Consequência honesta: ao fim destas tasks, I-Recon-7 fica cumprido em **(a) WARN** e **(b) endpoint**,
e **não cumprido em (c) detector**. Como os próprios followups dizem, *"sem isso, I-Recon-7 fica
meio-cumprido — e a promessa de que `parcial` não vira o novo silêncio depende dele"*. A Task 13
registra isso na ontologia em vez de deixar o invariante parecer verde.

---

## Riscos e ambiguidades detectados

1. **A ADR-0044 tem uma premissa refutada, e ela é o coração do I-Write-8a.** Não é ambiguidade:
   é fato medido. `titVldStatus = 1` é **ATIVO**, não "em aberto" (swagger `FinTituloFin`,
   verificado), e `usd` é **face**, não saldo. A soma que a ADR chama de "os títulos vivos" é a face
   bruta dos títulos ativos, quitados inclusive. Isso não quebra 8b nem I-Recon-5 — quebra
   especificamente o **calibre** de 8a, na direção de quase nunca disparar.
   O agravante é epistêmico: como a premissa está na ADR, todo teste escrito a partir dela herdaria
   o mesmo erro e passaria. Por isso a **Task 14 bloqueia** as Tasks 7 e 8, em vez de virar
   follow-up.
2. **A pré-checagem 8a tem três caminhos de não-disparo** (fallback, truncamento, tolerância). Cada
   um é uma porta pela qual o R-2 continua entrando — de propósito, porque a alternativa (abortar sob
   dado não confiável) quebra o caminho majoritário. Isso é aceitável **porque** 8b existe; se a
   Task 10 escorregar, 8a sozinha piora o sistema em vez de melhorá-lo. **Não fazer o merge de 8a
   sem 8b.**
3. **O advisory lock é por processo de banco, não distribuído no app.** `withAdvisoryLock` usa
   `pg_try_advisory_lock` num client dedicado do pool (`PostgreeDatabaseClient.ts:137-158`), então
   cobre múltiplas instâncias do backend — desde que apontem para o **mesmo** Postgres. Cobre o caso
   real (dois analistas, duas máquinas). Não cobre bancos distintos, o que não é o cenário.
4. **Colisão de hash int32 entre adiantamentos** custa serialização desnecessária de dois adtos
   distintos, nunca corretude — herdado do precedente SISPAG e aceito lá. Registrado para não ser
   redescoberto como bug.
5. **C-5 (dois `parcial` com significados diferentes no mesmo módulo)** é dívida de nomenclatura que
   este tweak **aumenta**. Renomear o `LoteAdiantamentoStatus.parcial` seria mais limpo, mas é um
   valor já serializado ao frontend e fora do escopo R-1/R-2. Fica documentado; candidato a
   follow-up.
6. **C-8 é a única lacuna real de modelagem que este scoping encontrou.** A ADR-0044 decidiu que
   `parcial` é preservado na re-execução, e decidiu que B3 reabre o adto quando o borderô é
   cancelado — mas não cruzou as duas. A resolução proposta (simetria com `settled`) é a leitura
   coerente com o critério que a própria ADR usa ("houve escrita irreversível **que ainda vale** sob
   esta chave?"), e está escopada na Task 10. Se o Yuri discordar, vira pergunta P0 e a Task 10
   pausa — não se resolve adivinhando.
7. **Ordem de merge importa em produção.** A Task 2 (migration) precisa estar aplicada **antes** de
   qualquer código gravar `'parcial'` — o CHECK antigo rejeita o INSERT em runtime, não no deploy, e
   a falha apareceria como `markParcial` estourando **depois** de baixas já POSTadas no ERP: o pior
   lugar possível para um erro. Migration primeiro, sempre.

---

## Definition of Done

Todas as tasks completas E:

- [ ] `cd src/backend && npm run typecheck` ✅
- [ ] `cd src/backend && npm run lint` ✅
- [ ] `cd src/backend && npm test` ✅
- [ ] `cd src/frontend && npm run typecheck && npm run lint && npm test` ✅
- [ ] PatternGuardian gate ✅
- [ ] `entity_changed = true` ⇒ diff de ontologia presente ✅ (já aplicado — ADR-0044)
- [ ] `src/frontend/` tocado ⇒ DesignSystemReviewer gate ✅ (Task 11)
- [ ] **Sem novo handler/job Lambda ⇒ ObservabilityAdvisor NÃO é acionado.** O delta muda serviços,
      repositório, rota Express existente e migration; nenhum handler ou job novo. (O detector
      proativo que justificaria uma revisão de observabilidade é o `cc-reaper-permutas`, fora de
      escopo.)
- [ ] **Sem `infra/` neste repo ⇒ AwsInfraArchitect NÃO é acionado.** Deploy é Render hook + Vercel
- [ ] **Ground-Truth gate** — classificação **PARCIAL**: há GT nativo (com298 RESUMO DOS TÍTULOS)
      para a perna BRL agregada; `SEM_GROUND_TRUTH` declarado para a perna em moeda negociada e para
      o desfecho `parcial`. `ontology/ground-truths/` **não existe neste repo** — criar com a 1ª
      ficha. Plano completo e critério de PASS/FAIL no fim deste documento ✅
- [ ] Regis-Review gate ✅ (0 P0; P1/P2/P3 → `ontology/_inbox/permutas-baixa-integridade-regis-followups.md`)
- [ ] Rebase de `main` aplicado, gates ainda verdes ✅
- [ ] Delta tem `fix` em `src/` ⇒ versão do app bumpada (FE+BE lockstep) via
      `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md` atualizado, commit `chore(release): vX.Y.Z` ✅


---

## Plano de Validação (Ground-Truth)

> **Veredito do catálogo: `ontology/ground-truths/` NÃO EXISTE neste repositório.** Verificado no
> worktree e no checkout principal. O catálogo (README + 5 fichas) vive só no repo irmão
> `fechamento-processos`. **Formalmente: nenhuma ficha aplicável.**
>
> **Mas o gate não é `SEM_GROUND_TRUTH` puro.** Este repo já exerce um ground truth nativo do Conexos
> para exatamente esta grandeza, com precedente versionado:
> `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts` compara a nossa derivação contra o bloco
> **RESUMO DOS TÍTULOS** do `com298/{docCod}`. **Classificação: PARCIAL** — GT real e executável para
> a perna BRL agregada por documento; `SEM_GROUND_TRUTH` declarado para a perna em moeda negociada e
> para o desfecho `parcial`.

### Fonte

| Perna | Fonte | Status |
|---|---|---|
| Saldo em aberto agregado por documento (BRL) | `GET com298/{docCod}` → **RESUMO DOS TÍTULOS**: `mnyTitValor`, `mnyTitPago`, `mnyTitAberto`. Via `ConexosTitulosClient.getDetalheTitulos`. É o que o analista vê na tela. | **GT primário.** Identidade `mnyTitValor = mnyTitPago + mnyTitAberto` com **0 violações em 408 docs** (`ontology/integrations/conexos.md:140-147`). |
| Universo / contagem de títulos | `count` do envelope `CnxListResponseFinTituloFin` na **mesma** chamada `com308/financeiroAPagar/list/{docCod}` | **GT primário** — hoje descartado (C-1b). Custo zero de chamadas. |
| Semântica do filtro | Chamada de controle ao mesmo endpoint **sem** `filterList`, com `fieldList` incluindo `titVldStatus` e `pago` | **GT primário.** Read-only. Decodifica o filtro empiricamente contra o enum. |
| Teto do adiantamento (`valorAlocado`) | `mnyTitPermutar` do `com298/{docCod}` — autoritativo, **nunca derivar** (`conexos.md:149-155`) | **GT primário.** |
| Saldo em aberto **por título** (BRL) | `rpFin010 — Contas a Pagar`, coluna `Vlr.Pagar`, chave `filCod × docCod × titCod` | **NÃO USAR nesta fatia** — este repo não tem motor `rp*` (zero `ReportsExecHistory`/`mpeCod` em `src/`). Portá-lo é feature própria. |
| Perna em moeda negociada (USD) | — | **`SEM_GROUND_TRUTH`** (ver "O que não valida"). |
| Desfecho `parcial` / resíduo pós-POST | — | **`SEM_GROUND_TRUTH` por construção** — exigiria POST. |

### Amostra

Script: `src/backend/jobs/validate-permutas-baixa-integridade-v1.ts` (convenção do repo é `jobs/`,
precedente `validate-invoice-pago-detalhe-v1.ts`).

**Casos canônicos (máx. 3 — anti-overfitting), com valores reais já registrados:**

| docCod | fil | O que é | Evidência |
|---|---|---|---|
| `4120` | 2 | **Único multi-título medido do repo** — 2 parcelas: 116.159,22 e 1.078,14 | `ontology/_inbox/permuta-multi-titulo-pendente.md:23-33` |
| `21841` | 2 | **Parcialmente pago** — pago 44.917,24 / aberto 1.621,34 | `ontology/integrations/conexos.md:163-165` |
| `8721` | 2 | **Resíduo de centavos** — aberto = 0,02 em título de ~R$ 20M | `ontology/integrations/conexos.md:36` |

**Casos novos:** universo `POST com298/list` com `filterList: { 'tpdCod#EQ': 128, 'vldStatus#IN':
['3'] }` (INVOICE + FINALIZADO). **`FILS=2,1`** (fil 2 é o volume da permuta; fil 1 entra para não
repetir o erro de escopo único que a ficha `rpFin010` documenta). **`N=150` por filial (300 total)**,
amostragem **espalhada** (`passo = max(1, floor(rows.length/N))`, como o v1) e não "as N mais
recentes" — invoices antigas têm perfil de pagamento diferente. Lado adiantamento: `tpdCod#EQ: 99` +
`docVldTipoAdto=1`, **N=100**, só para `mnyTitPermutar × valorAlocado`.
**Período:** posição corrente. Sem recorte histórico — o `XDATABASE` não reconstrói a situação do
título, então foto retroativa subestima. Registrar data/hora no dump.

### Chave de comparação

| Comparação | Chave |
|---|---|
| Agregado por documento | `filCod : docCod` |
| Contagem / truncamento | `filCod : docCod` → `rows.length` vs `envelope.count` |
| Semântica do filtro | `filCod : docCod : titCod` → `(titVldStatus, pago, titMnyValor − titMnyTotPago)` |
| Adiantamento | `filCod : docCod` (PROFORMA) |

### Fórmula e tolerância

Tudo em **BRL**, que é onde o ground truth vive. Por documento: 3 chamadas read-only
(`com308 list` filtrado, `com308 list` sem filtro, `com298/{docCod}`).

| ID | Nosso lado | Ground truth | Tolerância | O que uma divergência prova |
|---|---|---|---|---|
| **C1** | `Σ(titMnyValor − titMnyTotPago)` sobre `titVldStatus=1` | `det.valorAberto` | **R$ 0,01** | Se bate: o filtro captura todo o saldo aberto **e** não houve truncamento. Se não: C2/C3 desempatam. |
| **C2** | `rows.length` (filtrado) | `envelope.count` da mesma resposta | **exato (0)** | `count > rows.length` ⇒ truncamento confirmado, com o nº exato de linhas perdidas. Responde Q2 definitivamente. |
| **C3** | Conjunto de `titCod` **com** filtro | Conjunto **sem** filtro, cruzado com `titVldStatus` e `pago` | **exato (0)** na diferença | Cada `titCod` excluído sai rotulado com status, `pago` e saldo. Excluído com saldo > 0,01 = **dinheiro que o 8a não enxerga**. |
| **C4** | `Σ(titMnyValor)` sobre `titVldStatus=1` (a face que hoje alimenta `Σ titulos.usd`) | `det.valorTotal` **e** `det.valorAberto` | R$ 0,01 vs `valorTotal`; **sem tolerância** vs `valorAberto` — mede-se o **gap** | Quantifica em R$ quanto `Σ face` superestima a cobertura real. É a métrica que dimensiona C-1a e alimenta a **Task 14**. |
| **C5** | `aloc.valorAlocado` | `det.valorPermutar` (`mnyTitPermutar`, literal) | **0,005** moeda negociada | Regressão do teto de alocação. |

**Tolerância — justificativa:**
- **R$ 0,01 é o default**, o mesmo `OK_CENTAVO` da ficha `rpFin010`. Não afrouxar.
- **C2/C3 são contagem/conjunto ⇒ tolerância ZERO.** Não existe "quase o mesmo conjunto de títulos".
- O `0,005` de `restanteUsd <= 0.005` é **moeda negociada** e não se aplica a C1–C4, que são BRL.
  Usá-lo aqui trocaria as grandezas.
- **O `Math.max(0.01, emAbertoErp*0.005)` de I-Write-1 NÃO é tolerância deste gate:** ele compara
  contra `bxaMnyValor`, do **passo 2 do handshake de escrita**, que exige `borCod` já criado —
  **não é read-only**, logo fora do alcance por regra.
- Qualquer tolerância acima de centavo em C1/C4 é decisão do Yuri via **InfoGapBroker**, nunca do script.

**Veredito por linha:** `EXATO` (0) · `OK_CENTAVO` (≤ 0,01) · `DIVERGENTE` (> tolerância) ·
`NAO_VERIFICAVEL`. Amostra inteira `NAO_VERIFICAVEL` ⇒ amostra ruim ou receita quebrada — **não**
declarar PASS.

**Dump cru:** `reports/ground-truth-raw/<data>-permutas-baixa-integridade-v1/` (diretório **não
existe ainda** — criar). Salvar a resposta **não redigida** de ≥3 documentos: hoje **não existe uma
única fixture com308 com valores reais** (todas passam pelo redator de
`capture-fixtures-permutas.ts:57-60`, que zera números — daí o `"titVldStatus": 0`, valor que **nem
está no enum `[1,2,3]`**).

**Execução (read-only, sequencial):**
```
cd src/backend && PROBE_ALLOW_PRD=1 FILS=2,1 N=150 npx tsx jobs/validate-permutas-baixa-integridade-v1.ts
```
Mesmo gate de segurança do v1 (recusa PRD sem `PROBE_ALLOW_PRD=1`). **Exercitar o código de
produção** — importar `listTitulosAPagar` e `getDetalheTitulos` reais — em vez de replicar fórmula.
Só a chamada de controle sem filtro é montada à mão (via `base.paginate`, para ter `count`).

### O que este gate NÃO valida (`SEM_GROUND_TRUTH`, declarado)

1. **A perna em moeda negociada (USD).** `FinTituloFin` tem `titMnyValorMneg` e `titFltTaxaMneg`, mas
   **não tem `titMnyTotPagoMneg`** — o pago só existe em BRL, e o agregado `mnyTitAberto` é BRL. O
   "em aberto em USD" só sai por derivação, sem gabarito nativo. Como `Σ titulos.usd` de I-Write-8a é
   exatamente essa grandeza, ela é validada **indiretamente** (C1 em BRL + taxa). Propagação: com
   `taxa ≈ 5`, R$ 0,01 → ≈ USD 0,002, dentro do `0,005` já usado — coerente, mas **derivação, não medição**.
2. **O desfecho `parcial` / `valor_residual_usd`** (I-Recon-6/7, I-Write-8b): observá-lo ao vivo exige
   **POSTar baixas**. Fora do escopo por regra (read-only absoluto). Pertence à **Fase 1
   (Homologação)** de `docs/runbooks/fin010-write-cutover.md:21-29` + roteiro de QA.
3. **A serialização por advisory lock (I-Recon-5):** concorrência **Postgres-local**. Não há ground
   truth de ERP possível — cobertura é teste unitário (Task 4) + roteiro HML de dois callers.
4. **B1'** (`parcial-aguardando-finalizacao`): derivado de estado local + cache de borderô.
5. **Foto retroativa.**

### Resposta às duas perguntas de ground-truth do `listTitulosAPagar`

**Q1 — `titVldStatus = 1` significa "em aberto"? NÃO. Medido offline, e conferido por mim.**
É `1 ATIVO / 2 RENEGOCIADO / 3 CANCELADO` — ciclo de vida do registro, ortogonal ao pagamento. O eixo
de pagamento é `pago` (`1 TOTALMENTE PAGO / 2 PARCIALMENTE / 3 NÃO PAGO`), no mesmo DTO. Fonte:
`docs/conexos-api/070-com3.json`, schema `FinTituloFin` — o mesmo `serviceName` que o client envia.
**Nenhuma sonda era necessária.** O "30/30 sem divergência" de `invoice-pago-detalhe-tasks.md:96` é
**ausência de contraexemplo em 30 docs, não prova de equivalência** (e não tem artefato versionado —
o v1 só faz `console.log`). O que a sonda ainda acrescenta (C3) é *quanto dinheiro* os status 2/3
escondem — que é o que decide se 8a precisa trocar de filtro.

**Q2 — Existe invoice com >100 títulos? Não dá para responder offline, e a pergunta está mal-posta.**
O ERP impõe a própria página (medido em HML: `pageSize: 500` pedido → 50 linhas com `count: 86`), então
o teto pode ser < 100. **O critério certo é `rows.length == count`**, e custa zero chamadas extras (C2).
Medido hoje, em todo o ecossistema, existem **três** contagens reais de títulos por documento:
invoice `4120` = 2, invoice `4117` = 1, doc `5:1528` = 2. Os testes assumem 1 ou 2; **nenhum toca a
fronteira de paginação**. Não dá para medir offline porque nenhuma tabela local tem grão de título
para permutas (`permuta_invoice`/`permuta_alocacao`/`permuta_alocacao_execucao` são grão-documento), e
a única com grão-título — `titulo_a_pagar` — **exclui por design** o universo em questão
(`IngestaoPagamentosService.ts:147` filtra `!pago && !exterior`, e invoice de importação **é** exterior).
Aproveitamento parcial possível: `permuta_alocacao_execucao.request_payload` guarda os `titCod` das
baixas já feitas — enviesado para baixo, mas é a única medição local do universo certo.

**Recomendação independente do resultado:** trocar `callList` por `base.paginate` em
`listTitulosAPagar` custa ~5 linhas e já existe pronto (`PAGE_SIZE=500`, `MAX_PAGES=50`, parada por
`count`, `onCapHit` para `BUSINESS_WARN`). O método vizinho **no mesmo arquivo**
(`listBaixasTitulo:307`) já usa; no repo irmão o `com311/list/{docCod}` — **mesmo filtro** — pagina
corretamente. `listTitulosAPagar` é a exceção, e o comentário em `:236-244` justifica o boilerplate
obrigatório do endpoint, **não** o `pageSize: 100`. Se o máximo real for 3, a guarda é barata e sai
do caminho crítico; se for 100+, ela era o bug. O custo é o mesmo nos dois casos.

### Gaps a registrar (`ontology/_inbox/permutas-baixa-integridade-gt-gap.md`)

| Gap | Prioridade | Nota |
|---|---|---|
| `ontology/ground-truths/` **não existe neste repo** | P1 | Criar o diretório + `README.md` com a 1ª ficha **`com298-resumo-titulos.md`** (endpoint, `fieldList`, identidade `mnyTitValor = mnyTitPago + mnyTitAberto`, `mnyTitPermutar` autoritativo, casos canônicos 4120/21841/8721, `verified_at`). Portar as fichas do irmão é feature própria. |
| Perna em moeda negociada sem gabarito nativo | P2 | `SEM_GROUND_TRUTH` — validada só por derivação via `titFltTaxaMneg`. |
| Motor `rp*` ausente ⇒ `rpFin010`/`rpFin028` indisponíveis | P2 | Receita completa na ficha `rpimp180-resultado-processo.md` do repo irmão. Porte viável (`ConexosBaseClient` já tem `getGeneric`/`postGenericOnce`), mas é escopo próprio. |
| `docs/conexos-api/screens/com311.md:46` contradiz o swagger | P1 | **Task 14.** |
| Gap `com308-enum-pago (P3)` + card `integrability-7` | — | **RESOLVIDO offline** — enum no swagger. **Task 14.** |
| Nenhuma fixture com308 com valores reais | P2 | O dump cru desta execução vira a primeira. |
| `pageSize: 100` sem paginar em `listTitulosAPagar` | P0 se C2 divergir; senão P1 | Card transversal já existente e não implementado: `sispag-truncamento-observavel`. **Task 8.** |

### Critério de PASS/FAIL

- **PASS:** C1 e C4-vs-`valorTotal` todos `EXATO`/`OK_CENTAVO`; C2 e C3 com **zero** diferença; C5
  dentro de 0,005. Gravar sumário (amostra, filiais, N, data, Δ máximo, distribuição de `count`) —
  vira a seção "Ground-truth validation" do PR.
- **FAIL (P0):** qualquer `DIVERGENTE`. Diagnosticar antes de re-loopar: **bug de implementação** →
  Phase 3 da AutoLoopRunner, mesmo worktree; **regra de domínio ambígua** → **InfoGapBroker P0**;
  **gabarito errado** → corrigir a ficha junto com a evidência do probe.
- **Anti-recursão:** a remediação re-roda **este** gate; não re-dispara Regis-Review nem re-interview,
  salvo mudança de regra de domínio (aí o `OntologyCurator` entra).
