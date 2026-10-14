# Tasks: sispag-passo2-vinculo-codbar

**Spec source:** `ontology/_inbox/sispag-passo2-vinculo-codbar-proposta.md` (aprovada, decisões P0-1..3 e P1 fechadas) + ontologia v0.42.0 (commit 6f21242, `planned`)
**Ontology diff:** yes (já aplicado, `implementation_status: planned`) — `ontology/business-rules/vinculo-codbar-item-sispag.md` (I17a–l), `ontology/actions/sispag/vincular-codigo-barras-ao-item.md`, `ontology/decisions/0071-sispag-vinculo-codbar-ao-item-valor-igual.md`, emendas em `sugestao-boleto-dda-sispag.md` (I15a/I15b), `boleto-exige-codigo-de-barras.md` (ausência, I16d.1, I16d.2, I16d.4/I13j), `entities/lote-pagamento.md` (`ItemLote.vinculoCodigoBarras`), `entities/decisao-sugestao-boleto.md` (derivado `aplicacao`), `retomada-remessa-sispag.md` (etapa `vincular_codbar`)
**entity_changed:** true (`ItemLote` ganha `vinculoCodigoBarras`; sem entidade nova, sem estado novo em `DecisaoSugestaoBoleto`)
**Estimated scope:** XL (backend ~14 arquivos novos/alterados + 1 migration + rota + frontend 4 arquivos + 2 jobs de verificação: HML de escrita e sonda PRD somente leitura)
**Mode:** `/feature-new` (passo 2 do ADR-0068). Estende `RemessaService`, `RetiradaCodigoBarrasService` e `ConexosSispagWriteClient`; não reescreve.
**Entrega:** o código sobe com modo **`off`** como default e `shadow` como máximo antes da prova (P0-3). Nada nesta PR liga `on` em PRD.

## Decisões fechadas (não reabrir)

- **Autoridade (P0-1):** decisão humana `CONFIRMADA` + verificações nossas (I17b–d) autorizam o vínculo; I15a emendada (validação ao vivo = autoridade do caminho DDA).
- **Falha (P0-2):** determinística pós-import retira pela maquinaria da I16d (motivo `VINCULO_CODIGO_BARRAS_FALHOU`) e a remessa segue; transitória/ambígua aborta com `VinculoCodigoBarrasIncompletoError` e retoma; nunca retira.
- **Ordem em PRD (P0-3):** HML V1–V9 → sonda PRD somente leitura de permissão do robô → `shadow` em PRD → **um** título real controlado → ampliar. `on` em PRD só depois de V-PRD1 e V-PRD2.
- **P1:** janela `0 ≤ Δdias ≤ 5` e barra ≥ `dataDebito` (mesma constante global `DIAS_DEPOIS_MAX` da I15c); `shadow` visível só por endpoint + log (sem selo na tela); desempate da I16d.1 prefere o único título do grupo com decisão humana vigente; vínculo em **cinco** colunas nullable de `ItemLote`, **uma** migration; endpoint `GET /sispag/lotes/:id/vinculos-previstos` incluído.
- **Flag:** `SISPAG_BIND_CODBAR_FILIAIS="1:shadow,7:off"` via `EnvironmentProvider`; filial ausente, modo desconhecido ou parse inválido ⇒ `off` (fail-closed); `sispagLiveWriteEnabled=false` derruba também o vínculo; `SISPAG_DDA_ASSOC_ENABLED=false` **não** o desliga.
- **`shadow`:** só pré-condições e verificações **locais** (I17a–d sobre o pool/banco), grava `VINCULO_SIMULADO`, **zero chamada nova ao ERP**, comportamento da remessa idêntico a `off`.
- **Privacidade (I17j):** linha digitável completa só em memória; persiste/loga **só** o mascarado 5+4. O CHECK da 0049 do ledger **não** aceita etapa nova: `vincular_codbar` é etapa de **memória** (como `limpar_retirados`).

## Fatos do código que moldam as tasks (verificados em 2026-10-14 neste worktree)

- `ConexosSispagWriteClient` **não tem** `validacao/codigoBarras`, `confirmaCodigoBarras` nem `PUT fin015/finItemSispag`. Tem `listarLinhasDigitaveisDoLote` (já com `filCod`/`itsCodSeq`, paginado, `completa`), `removerItemDoRascunho` (DELETE tentativa única via `base.deleteGeneric`), `importarTitulos`, `listarTitulosPendentes`. `ConexosBaseClient` já expõe `postGenericOnce` e `putGenericOnce` (tentativa única, sem 401-retry); a leitura usa `runWithRetry`.
- `listarLinhasDigitaveisDoLote` devolve só `docCod/titCod/linhaDigitavel/filCod/itsCodSeq` e **descarta** a linha completa do item: o `PUT` precisa do **item lido inteiro** com 5 campos alterados, então falta um `lerItemDoRascunho` que devolva a row crua (Zod, passthrough).
- `RemessaService.montarItensImport` lança `BoletoSemCodigoBarrasError` para todo BOLETO sem `temBoletoDda` (≈ l.1186); `associarDda = ddaHabilitado && BOLETO && temBoletoDda`. A guarda I16 roda em (2.1) via `this.retirada.garantir({...})` depois de `setEtapa(key, 'finalizar')` e só se `retomarDe !== 'concluido'`. `ORDEM_ETAPAS = criar_lote, importar, limpar_retirados, finalizar, gerar_remessa, concluido`. O kill-switch é `dryRun = !writeEnabled || !env.sispagLiveWriteEnabled || env.conexosDryRun || input.dryRunOverride`.
- `RetiradaCodigoBarrasService.decidir` chama `AnaliseCodigoBarrasRepetido.decidirRetirada` com `locais` (vencimento) — o desempate novo precisa de um conjunto de "chaves com decisão humana vigente" injetado, sem I/O na análise (continua pura).
- `SYSTEM_REMOVAL_REASON` (`SispagInterface.ts`) já tem `CODIGO_BARRAS_REPETIDO` e `CODIGO_BARRAS_ILEGIVEL`; falta `VINCULO_CODIGO_BARRAS_FALHOU`. O evento da retirada reusa `ITEM_REMOVIDO_SISTEMA` com `dados.motivo` (precedente Q2 da remoção): **sem** mexer no CHECK da 0078.
- Trilha de sugestão: `sispag_sugestao_boleto_evento` (0084) tem CHECK de `tipo` com 6 valores e **não** tem coluna `lote`: os 3 tipos novos exigem `ALTER CONSTRAINT` e a chave de idempotência `(lote, título, decisaoId)` precisa viver em `detalhe` ou em coluna nova (ver Q4).
- `RegraSugestaoBoleto` exporta `DIAS_DEPOIS_MIN = 1` e `DIAS_DEPOIS_MAX = 5`: o `Δ = 0` da I17c é coberto pela regra (a) "mesmo dia, |Δvalor| ≤ R$ 0,05" do tier, não pela faixa 1–5. A elegibilidade nova usa `DIAS_DEPOIS_MAX` e piso `0` próprio, sem tocar o `MIN`.
- Migrations: **0085** é a última em `origin/main` (e aqui); próximo livre = **0086**. Reconferir `origin/main` e branches abertas antes do ship (versões e migrations colidem entre sessões paralelas). Nenhuma branch remota listada traz `0086+`.
- Tabela dos itens locais: `lote_pagamento_item` (0023). O build copia `*.sql` por `migrations/copy-to-dist.ts`; teste de paridade deve cobrir o arquivo novo (incidente 2026-09-23).
- Único chamador de `RemessaService.gerarRemessa` em produção: `routes/sispag.ts` (lote manual e automático passam pela mesma rota).
- Harness HML existente: `src/backend/jobs/hmlEnvFile.ts` (`HML_ENV_FILE`) e os `probe-hml-*` da branch `origin/chore/sispag-hml-bind-experimentos` (`probe-hml-validacao-codbar.ts`, `probe-hml-importar-codbar.ts`, `probe-hml-editar-item-codbar.ts`, `probe-hml-diff-item.ts`, `probe-hml-item-variantes.ts`, `probe-hml-fin026-titulo.ts`) — **não** estão neste branch exceto `hmlEnvFile.ts` e `probe-hml-delete-item-inexistente.ts`.

## Ground-truth plan (obrigatório, monetário e escrita no ERP)

**Status: PARCIAL.** Já medido em HML (2026-10-14, `sispag-passo2-hml-achados.md`): `importar` descarta o código; sequência `validacao → confirma → PUT` grava o item; ERP não valida DV nem compara com o título; barra de valor igual finaliza e a remessa sai (J com barra/valor/data); acima do aberto o `finalizar` recusa. **SEM_GROUND_TRUTH** para V1–V9 da proposta §6.1 (Task 17): sequência no **client de produção**, idempotência do `PUT`, terceiro, modalidade 6/7 após o `PUT` (V4), `PUT` em lote finalizado, reaparecimento do boleto no pool depois do pagamento (V6), layouts 237/104/329, `totalAberto` com desconto/acréscimo, bordas de data. Validação ao vivo em PRD por `GroundTruthValidator` **não se aplica** a escrita; PRD só tem sonda somente leitura (Task 18) + `shadow` + 1 título controlado. **V1–V9 bloqueiam o merge com o modo `on` documentado como "provado"**; não bloqueiam implementar (o desenho é robusto: sucesso = observação na releitura).

## Task list

### Task 1: RED — elegibilidade pura do vínculo (I17a–d, só locais)
**Files to change:**
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.test.ts` (novo)
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts` (só contrato de tipos, sem lógica, para o teste compilar)

**Acceptance criteria:**
- [ ] Valor em centavos: igual elegível; diferença de ±1 centavo **inelegível** com motivo `VALOR_DIFERENTE` e delta com sinal; compara com `totalAberto` ao vivo recebido como entrada, nunca com `ItemLote.valor` (teste: `ItemLote.valor` diferente do aberto não muda o resultado)
- [ ] Data: `Δdias` −1 / 0 / 5 / 6 ⇒ inelegível / elegível / elegível / inelegível (`ATENCAO`, fora do escopo); barra = `dataDebito` elegível; barra um dia antes da `dataDebito` inelegível; data civil UTC meia-noite (fixture com offset São Paulo não desloca o dia)
- [ ] Decisão: só `CONFIRMADA` não órfã com par `VIGENTE`; `REJEITADA`, `ANULADA`, ausente, órfã, par revogado ⇒ inelegível com motivo distinto
- [ ] Tier recalculado: `CONHECIDO`/`FORTE` elegíveis; `ATENCAO` nunca (I15d)
- [ ] DV: 44/47 dígitos, DV de campo e geral via `CodigoBarrasBoleto.paraBarras`; arrecadação (inicia por `8`) inelegível; DV corrompido inelegível
- [ ] Item com `temBoletoDda = true` não entra (caminho DDA); modalidade ≠ BOLETO não entra; lote fora do rascunho não entra
- [ ] Saída carrega só `mascarado` (5+4); `JSON.stringify` do resultado não contém 44 dígitos nem a linha de 47
- [ ] Os testes **falham** antes da Task 2 (RED comprovado)

**Dependencies:** none

---

### Task 2: Elegibilidade pura implementada
**Files to change:**
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts`

**Acceptance criteria:**
- [ ] Task 1 verde; sem I/O, sem ledger, sem log; classe exportada, métodos arrow, modificadores explícitos
- [ ] Constantes de faixa importadas de `RegraSugestaoBoleto` (`DIAS_DEPOIS_MAX`); piso `0` definido aqui e documentado (não altera `DIAS_DEPOIS_MIN`)
- [ ] Reutilizável pelo `shadow`, pelo endpoint `vinculos-previstos` e pelo executor (mesma função nos três)
- [ ] `typecheck` e Biome ok

**Dependencies:** Task 1

---

### Task 3: Flag por filial `SISPAG_BIND_CODBAR_FILIAIS` (fail-closed) — RED + GREEN
**Files to change:**
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` (as duas ocorrências do bloco que lê `SISPAG_DDA_ASSOC_ENABLED`, ≈ l.349 e l.448)
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/libs/boleto/ModoVinculoCodigoBarras.ts` + `.test.ts` (novo; `resolverModo(filCod, mapa, liveWriteEnabled)`)

**Acceptance criteria:**
- [ ] Testes primeiro: `"1:shadow,7:off"` ⇒ filial 1 `shadow`, 7 `off`, 2 `off`; vazio/ausente ⇒ `off` em todas; `"1:on"` ok; `"1:ON"`, `"1:foo"`, `"abc"`, `"1:on,"` com lixo ⇒ **a entrada inteira cai em `off`** (parse inválido não vira parcial; documentar a escolha no teste)
- [ ] `sispagLiveWriteEnabled=false` ⇒ `off` mesmo com `1:on`; `conexosDryRun`/`dryRunOverride` ⇒ nunca executa escrita (`shadow` ainda calcula)
- [ ] `SISPAG_DDA_ASSOC_ENABLED=false` **não** altera o modo (teste dedicado)
- [ ] Nenhum `process.env` fora do `EnvironmentProvider`; constantes tipadas `MODO_VINCULO = { OFF, SHADOW, ON }`
- [ ] Documentada em `DEPLOY.md` (ou onde as envs de SISPAG estão listadas) com default `off`

**Dependencies:** none (paralelizável com 1–2)

---

### Task 4: Migration 0086 (cinco colunas de `ItemLote` + 3 tipos de evento) e paridade de build
**Files to change:**
- `src/backend/migrations/0086_sispag_vinculo_codigo_barras.sql`
- `src/backend/migrations/0086_sispag_vinculo_codigo_barras.test.ts`
- `src/backend/migrations/0086_sispag_vinculo_codigo_barras.integration.test.ts`
- `src/backend/migrations/rollbacks.test.ts` (se for o padrão do repo para migrations aditivas)

**Acceptance criteria:**
- [ ] Reconferir o próximo número livre em `origin/main` imediatamente antes de commitar (hoje 0086); se ocupado, renomear todos os artefatos
- [ ] `ALTER TABLE lote_pagamento_item ADD COLUMN IF NOT EXISTS vinculo_origem TEXT NULL, vinculo_decisao_id UUID NULL, vinculo_codigo_mascarado TEXT NULL, vinculo_aplicado_em TIMESTAMPTZ NULL, vinculo_flp_cod INTEGER NULL` (tipo de `decisao_id` conforme a PK real de `sispag_decisao_sugestao_boleto`)
- [ ] CHECK `vinculo_origem IS NULL OR vinculo_origem IN ('ERP_DDA','DECISAO_HUMANA')`; CHECK "tudo ou nada" (`origem` nulo ⇒ as outras quatro nulas; `DECISAO_HUMANA` ⇒ `decisao_id` não nulo)
- [ ] CHECK `vinculo_codigo_mascarado IS NULL OR ~ '^[0-9]{5}…[0-9]{4}$'` no mesmo formato do `codigo_mascarado` da 0085 (**o schema recusa código longo**, I17j)
- [ ] `ALTER TABLE sispag_sugestao_boleto_evento DROP CONSTRAINT ... ADD CONSTRAINT` com os 6 tipos atuais + `VINCULO_APLICADO`, `VINCULO_SIMULADO`, `VINCULO_FALHOU` (idempotente: guard de existência); a trilha continua só-inclusão (trigger intacto)
- [ ] Linhas existentes não reescritas, sem backfill (legado = `ERP_DDA` implícito)
- [ ] Teste estático: o `.sql` é listado pelo `copy-to-dist`/`MigrationFiles` (paridade; incidente 2026-09-23)
- [ ] Teste de integração (Postgres de teste): origem inválida ⇒ erro; máscara com 44 dígitos ⇒ erro; evento com tipo novo aceito, tipo desconhecido recusado; reexecutar a migration é no-op
- [ ] **Sem** `ALTER` no CHECK do ledger (0049): a etapa `vincular_codbar` não vai ao ledger

**Dependencies:** none (paralelizável)

---

### Task 5: Erros nomeados do vínculo
**Files to change:**
- `src/backend/domain/errors/VinculoCodigoBarrasIncompletoError.ts` + `.test.ts` (409, `retryable`/retomável)
- `src/backend/domain/errors/VinculoCodigoBarrasDivergenteError.ts` + `.test.ts` (409)
- `src/backend/domain/errors/ItemEditadoPorTerceiroError.ts` + `.test.ts` (409; etapa `indeterminado`)

**Acceptance criteria:**
- [ ] Testes primeiro; `code`/`statusCode`/`details` conforme a tabela "Erros nomeados" da regra I17; `message` em inglês (identificador), `userMessage` pt-BR com `docCod/titCod`, valores, Δ com sinal e código **mascarado**
- [ ] Sanitização defensiva (`\d{10,}` → `…`) como em `BoletoCodigoBarrasRetiradaIncompletaError`; teste injeta 44 e 47 dígitos em texto livre
- [ ] `Incompleto` diz: o que já foi vinculado, o que falta, que **nada foi enviado ao banco** e que reexecutar retoma; `ItemEditadoPorTerceiro` diz qual campo divergiu sem expor o código
- [ ] Nenhuma dependência de infra

**Dependencies:** none (paralelizável)

---

### Task 6: RED — cliente: `validarCodigoBarras`, `confirmarCodigoBarras`, `lerItemDoRascunho`, `editarItemDoRascunho`
**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.test.ts`
- `src/backend/domain/client/__fixtures__/` (respostas **gravadas do HML** do harness da branch `chore/sispag-hml-bind-experimentos`, com códigos sintéticos e mascarados nos snapshots)

**Acceptance criteria:**
- [ ] `validarCodigoBarras`: `POST fin015/finItemSispag/validacao/codigoBarras` com o código de 47 (ou 44); resposta validada por Zod devolve `splitCodBar`, `barraVlrPgto`, `barraDtaVencimento`; **não** infere validade do DV a partir do SUCESSO (HML #3: DV corrompido volta SUCESSO); só `FIN_015.CODIGO_BARRA_INVALIDO` vira erro de negócio
- [ ] `confirmarCodigoBarras`: `POST .../validacao/confirmaCodigoBarras` com o `splitCodBar` da etapa anterior; devolve `itsMnyVlrPgtoResult`, `itsDtaPgtoResult`, `itsBncNumCodbancoResult`, `itsBncDesNomeResult` (Zod; campo ausente ⇒ erro de contrato, nunca default)
- [ ] `lerItemDoRascunho`: devolve a **row completa** do `finItemSispag/list` para `(filCod, bncCod, flpCod, itsCodSeq)`, via leitura paginada; item ausente ⇒ `undefined` (não lança); leitura incompleta ⇒ erro distinguível de "ausente"
- [ ] `editarItemDoRascunho`: `PUT fin015/finItemSispag` via `putGenericOnce` (**tentativa única**, sem retry cego, sem 401-retry), corpo = item lido com **exatamente** `itsNumCodbar`, `itsNumBanco`, `bncDesNome`, `itsMnyVlrPgto`, `itsDtaPgto` alterados (teste compara diff campo a campo: nenhum outro campo muda); header `cnx-filcod` = filial do **lote**
- [ ] Erros mapeados por `toConexosError`; 4xx de negócio distinguível de timeout/5xx/resposta ilegível (insumo da matriz determinístico × transitório, I17g)
- [ ] Teste: o código completo nunca aparece em log, mensagem de erro nem `details` do cliente
- [ ] Os testes **falham** antes da Task 7

**Dependencies:** none (paralelizável com 1–5)

---

### Task 7: Cliente implementado
**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.ts`

**Acceptance criteria:**
- [ ] Task 6 verde; reuso de `ITS_COD_SEQ_SCHEMA`/`toConexosError`; schemas Zod no boundary
- [ ] Leitura com `runWithRetry`; escritas (`confirma`, `PUT`) **sem** retry cego; `validacao` é leitura/decodificação e pode usar `runWithRetry`
- [ ] Retrocompat: `listarLinhasDigitaveisDoLote`, `removerItemDoRascunho`, `importarTitulos` inalterados
- [ ] `typecheck`, Biome, testes do client ok

**Dependencies:** Task 6

---

### Task 8: RED + GREEN — repositórios: persistência do vínculo e trilha idempotente
**Files to change:**
- `src/backend/domain/interface/sispag/SispagInterface.ts` (`ItemLote.vinculoCodigoBarras?`, `SYSTEM_REMOVAL_REASON.VINCULO_CODIGO_BARRAS_FALHOU`)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (gravar/ler as 5 colunas; `versao`+1 ao gravar; `map` devolve o objeto ou ausente)
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts` (`NovoEventoSugestao` com os 3 tipos; consulta "existe `VINCULO_APLICADO` para (lote, título, decisaoId)")
- testes correspondentes + `LotePagamentoRepository.integration.test.ts` (ou o arquivo de integração existente)

**Acceptance criteria:**
- [ ] Testes primeiro: gravar vínculo incrementa `versao`; leitura de linha legada devolve `vinculoCodigoBarras` ausente; `mascarado` fora do formato é recusado no repositório antes do banco
- [ ] Evento `VINCULO_APLICADO` único por `(lote, título, decisaoId)`: segunda chamada não insere (consulta + `ON CONFLICT` conforme a resposta da Q4); `VINCULO_SIMULADO` e `VINCULO_FALHOU` registram motivo + mascarado, nunca o código
- [ ] SQL parametrizado; nenhuma interpolação; métodos arrow, modificadores explícitos
- [ ] `LotePagamentoApiView` expõe `vinculoCodigoBarras` (só campos mascarados) — teste de snapshot de chaves
- [ ] Nenhum campo, tipo ou log carrega o código completo

**Dependencies:** Task 4

---

### Task 9: RED — `VinculoCodigoBarrasService` (executor da sequência I17e)
**Files to change:**
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.test.ts` (novo; fakes de client/repos)

**Acceptance criteria (cada um é um teste que falha antes da Task 10):**
- [ ] Caminho feliz: ordem das chamadas `ler item (itsCodSeq vivo) → validarCodigoBarras → confirmarCodigoBarras → editarItemDoRascunho → ler item (releitura)`; `VINCULO_APLICADO` + `ItemLote.vinculoCodigoBarras` gravados **só depois** da releitura
- [ ] Sucesso = observação na releitura: `PUT` devolve 200 mas a releitura não mostra o código ⇒ **não** é sucesso (`VinculoCodigoBarrasIncompletoError`); `PUT` falha (timeout/5xx) mas a releitura mostra o código/banco/valor/data esperados ⇒ sucesso (observação vence status)
- [ ] Decisão e boleto relidos do banco/pool **no momento do vínculo**, nunca do `SugestaoBoletoCache` (teste: cache devolve decisão `CONFIRMADA`, banco devolve `ANULADA` ⇒ inelegível); tier recalculado agora
- [ ] Verificações nossas pós-`confirma` (I17d 3–6): banco do código ≠ banco do confirm, valor decodificado ≠ aberto, data decodificada ≠ `itsDtaPgtoResult`, `itsMnyVlrPgtoResult ≠ valorBoleto` (juros/desconto ≠ 0) ⇒ `VinculoCodigoBarrasDivergenteError` **sem** `PUT`
- [ ] Idempotência (I17f): item que já traz `itsNumCodbar` igual (comparado em 44) com valor/data coerentes ⇒ nenhuma chamada nova, nenhum evento duplicado
- [ ] Terceiro (I17f): `itsNumCodbar` diferente do esperado, ou valor/data diferentes do que gravaríamos ⇒ `ItemEditadoPorTerceiroError`, nada sobrescrito, nada retirado
- [ ] Matriz de falha (§4.2): `validacao` OK + `confirma` transitório ⇒ Incompleto e item refeito do zero; `PUT` 4xx de negócio ⇒ determinístico (retorna `retirar` com motivo `VINCULO_CODIGO_BARRAS_FALHOU`); timeout/5xx/resposta ilegível/leitura incompleta ⇒ Incompleto, **nunca** retirar
- [ ] Código já presente em outro item do rascunho (lista lida antes do `PUT`) ⇒ não vincula; retorno determinístico `retirar` (I17g(3))
- [ ] Execução em **série** (não paralelo); falha transitória no item 2 mantém o item 1 vinculado (parcial persistido, retomada idempotente)
- [ ] `shadow`: zero chamadas ao client (assert `expect(client.*).not.toHaveBeenCalled()`), grava `VINCULO_SIMULADO` com elegível/inelegível e motivo, devolve previsão; `off`: nada, nem evento
- [ ] Varredura: nenhum argumento de `LogService`, ledger, evento ou erro contém 44 dígitos nem a linha de 47

**Dependencies:** Tasks 2, 3, 5, 7, 8

---

### Task 10: `VinculoCodigoBarrasService` implementado
**Files to change:**
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts` (novo, `@injectable()`)
- `src/backend/domain/appContainer.ts` (se o registro explícito for padrão; senão auto-resolve)

**Acceptance criteria:**
- [ ] Task 9 verde; `typecheck`, `lint`, `test` verdes
- [ ] Leitura ao vivo de `totalAberto` do título pela fonte `fin064` já usada no projeto (ver Q2); nunca `ItemLote.valor`
- [ ] Métodos públicos: `prever(lote)` (shadow/endpoint, sem ERP), `executar({lote, bncCod, flpCod})` → `{ vinculados, retirar[], abortados }`; sem `setTimeout` manual (`RetryExecutor` só em leitura)
- [ ] Mensagens de log/erro ao operador em pt-BR; identificadores em inglês (ADR-0042); `LogService.warn` com `type: BUSINESS_WARN` e `data: { loteId, flpCod, elegiveis, vinculados, retirados, abortados }` mascarado
- [ ] Nenhum `process.env`; flag via `EnvironmentProvider`

**Dependencies:** Task 9

---

### Task 11: RED + GREEN — `RetiradaCodigoBarrasService`: motivo novo e desempate por decisão humana
**Files to change:**
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` + `.test.ts` (parâmetro opcional `preferidos: ReadonlySet<string>`)
- `src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts` (aceita `preferidos` e `retiradosPeloVinculo`; reusa `retirarAlvos`)
- `src/backend/domain/service/sispag/RetiradaCodigoBarrasService.test.ts` (criar se não existir; hoje só `RemessaService.test.ts` exercita)
- `src/backend/domain/interface/sispag/SispagInterface.ts` (já na Task 8)

**Acceptance criteria:**
- [ ] RED primeiro: grupo com **exatamente um** título com decisão humana vigente ⇒ ele fica, mesmo com vencimento maior; dois ou zero preferidos ⇒ vale `vencimento → docCod → filCod → titCod` (comparação numérica) como hoje
- [ ] A análise continua **pura** (sem I/O); o conjunto `preferidos` é montado pelo chamador a partir das decisões vigentes (I17a)
- [ ] Retirada determinística do vínculo usa a mesma maquinaria I16d.3 (local primeiro em 1 transação: remove + marca ATIVA + evento; depois `DELETE` com `itsCodSeq` relido; releitura confirma ausência) com `motivo = VINCULO_CODIGO_BARRAS_FALHOU`, marca `BloqueioDuplicidade` com `origem` coerente (ver Q5) e `avisos` (I16f)
- [ ] Idempotência I16d.5 preservada (reexecução ⇒ 0 novo evento, 0 nova marca)
- [ ] Item vinculado e depois retirado como repetido: o evento de retirada **sobrepõe** `VINCULO_APLICADO` na leitura da tela (teste do derivado `aplicacao`)
- [ ] Nenhuma regressão nos testes existentes de `AnaliseCodigoBarrasRepetido` e da guarda

**Dependencies:** Tasks 8 (enum), 10 (contrato de `retirar[]`)

---

### Task 12: RED — `RemessaService`: etapa `vincular_codbar`, exceção no pré-import, resume
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.test.ts`

**Acceptance criteria (cada um falha antes da Task 13):**
- [ ] Pré-import: BOLETO sem DDA **elegível local** (I17a–d) com modo `on` segue para o import com `associarDda=false` e **sem** destino (barra define o destino); inelegível ou modo `off`/`shadow` ⇒ `BoletoSemCodigoBarrasError` **antes de qualquer escrita** (comportamento atual preservado literalmente)
- [ ] Ordem das etapas: `criar_lote → importar → vincular_codbar → (guarda I16 / limpar_retirados) → finalizar → gerar_remessa`; a guarda I16 roda sobre o **conjunto final** (DDA + vinculados) e `finalizarLote` só depois
- [ ] Desempate: item vinculado (decisão vigente) vs item DDA com mesmo código e vencimento menor ⇒ o vinculado fica (Task 11 integrada)
- [ ] Falha transitória no vínculo ⇒ `VinculoCodigoBarrasIncompletoError`, ledger `failed`, rascunho preservado, **nenhuma** retirada; determinística ⇒ item retirado, remessa segue, `retiradosPorCodigoBarras`/`avisos` preenchidos
- [ ] Resultado ganha `vinculados` (mascarados); `avisos` não vazio quando houve vínculo ou retirada (padrão I16f), para a automação diária não tratar "tudo certo"
- [ ] `ORDEM_ETAPAS` ganha `vincular_codbar` entre `importar` e `limpar_retirados`; **não** vai ao ledger (assert: `setEtapa` nunca chamado com `vincular_codbar`)
- [ ] `sincronizarComErp` devolve `vincular_codbar` quando: rascunho completo ∧ modo `on` ∧ existe item BOLETO sem código com decisão elegível; lote nativo **finalizado** nunca (I17i): retomada em `gerar_remessa` com item sem código cai em I16c (aborta)
- [ ] `pular('importar')`/`pular('vincular_codbar')`/`pular('finalizar')` coerentes (tabela de verdade testada)
- [ ] `shadow`/`off`: sequência de chamadas ao ERP **idêntica** à de hoje (snapshot de chamadas; zero chamada nova)
- [ ] Kill-switch: `sispagLiveWriteEnabled=false` com modo `on` ⇒ comportamento de `off`
- [ ] Homônimo cross-filial: chaves com `filCod` (regressão)

**Dependencies:** Tasks 3, 10, 11

---

### Task 13: `RemessaService` implementado
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (exceção em `montarItensImport`; bloco `vincular_codbar` entre o import e (2.1); `ORDEM_ETAPAS`/`EtapaReal`; `sincronizarComErp`; `GerarRemessaResult.vinculados`)

**Acceptance criteria:**
- [ ] Task 12 verde; `typecheck`, `lint`, `test` verdes
- [ ] `setEtapa(key, 'finalizar')` continua **antes** da guarda (a retomada passa por `sincronizarComErp` → `vincular_codbar`)
- [ ] Tudo abaixo do vínculo lê `loteFinal`, nunca o snapshot do início (o lote local muda: `versao`, itens)
- [ ] Se `RemessaService` ultrapassar ~2000 linhas, extrair o ramo de montagem para o `VinculoCodigoBarrasService` (decisão do implementador, mantendo o ponto de chamada)
- [ ] Nenhum `process.env`; nenhum `setTimeout`; logs pt-BR

**Dependencies:** Task 12

---

### Task 14: Endpoint `GET /sispag/lotes/:id/vinculos-previstos` (dry-run visível) — RED + GREEN
**Files to change:**
- `src/backend/routes/sispag.ts` (nova rota, `exigirPermissao(PERMISSION.SISPAG_VER)`, `Cache-Control: no-store`)
- `src/backend/routes/sispag.test.ts`
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts` (`prever`, já na Task 10, exposto)

**Acceptance criteria:**
- [ ] Testes primeiro: 200 com `{ modo, itens: [{ titulo, elegivel, motivo?, deltaDias?, deltaCentavos?, codigoMascarado?, decisaoId? }] }`; modo `off` ⇒ lista vazia + `modo: 'off'`; lote inexistente 404; permissão `sispag:ver`
- [ ] Teste de snapshot de chaves: **nenhum** campo de linha digitável/barras completa
- [ ] Leitura apenas local (banco/pool); **zero** chamada ao ERP (assert no client fake)
- [ ] Rota de `gerarRemessa` devolve `vinculados` e `avisos` na 200; ausente quando vazio (compat. com cliente antigo)
- [ ] Sem permissão nova (R11 da proposta)

**Dependencies:** Task 10

---

### Task 15: Frontend — selo no `LoteCard`/aba Títulos e aviso na anulação
**Files to change:**
- `src/frontend/lib/sispag.ts` (+ `sispag.test.ts`): tipos `VinculoCodigoBarras`, `VinculoPrevisto`, `vinculados`; função de API de `vinculos-previstos`
- `src/frontend/app/sispag/components/LoteCard.tsx` (+ `LoteCard.test.tsx`)
- `src/frontend/app/sispag/components/GerarRemessaDialog.tsx` (+ test): sucesso com `avisos` mostra resumo do vínculo/retirada em vez de "tudo certo"
- `src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx` (+ test): ao anular decisão, aviso se há item vinculado em lote vivo (I17l)
- `src/frontend/app/sispag/page.tsx` (aba de títulos)

**Acceptance criteria:**
- [ ] Selo **previsto** ("boleto será vinculado na remessa (confirmação de <pessoa>, <data>)") só com modo `on`; derivado, nunca promete (a remessa relê); inelegível por faixa mostra motivo e Δ com sinal; `shadow` **não** mostra selo (só endpoint + log, P1-2)
- [ ] Selo **persistente** "vinculado por confirmação · barra 12345…6789 · R$ x · paga em dd/mm" a partir de `ItemLote.vinculoCodigoBarras`; sobrevive a recarregar a página
- [ ] Item vinculado e depois retirado não aparece como sucesso (o evento de retirada prevalece)
- [ ] Anular confirmação com item vinculado em lote vivo: aviso explícito de que o item **não** é desfeito no ERP e que a analista deve retirar o título do lote (I17l); sem botão "desfazer vínculo" (não existe no escopo)
- [ ] Nenhuma tela, `title`, `aria-label` ou `console.*` com o código completo (teste varre o DOM com um fixture de 44 dígitos)
- [ ] Acessibilidade: `role="status"`/`alert` adequado, contraste e foco conforme o design system; tokens de `src/frontend/docs`, sem cor literal
- [ ] `npm run lint`, `typecheck`, `test` em `src/frontend` verdes (não usar `prettier --check`)
- [ ] **Gate DesignSystemReviewer ✅** (frontend tocado)

**Dependencies:** Task 14

---

### Task 16: Teste de privacidade transversal e observabilidade (sem novo handler)
**Files to change:**
- `src/backend/domain/service/sispag/VinculoCodigoBarrasPrivacidade.test.ts` (novo; integra service + `RemessaService` com fakes que registram **tudo** que sai)
- `src/backend/domain/service/sispag/RemessaService.ts`/`VinculoCodigoBarrasService.ts` (somente pontos de log)

**Acceptance criteria:**
- [ ] Varredura de `LogService`, ledger, trilhas (`sispag_sugestao_boleto_evento`, `sispag_verificacao_evento`), `BloqueioDuplicidade`, erros e respostas de rota: nenhum string com 44 dígitos contíguos nem a linha de 47 (exceto o `PUT`/`validacao` em memória)
- [ ] Não há handler/job de produção novo ⇒ ObservabilityAdvisor **não** é acionado como gate; contadores `elegiveis/vinculados/retirados/abortados` ficam em log + trilha (dado para alerta futuro, sem dashboard agora)
- [ ] Caminho "lote sem item elegível" não chama o client novo, não grava evento e não altera `GerarRemessaResult` (teste dedicado)

**Dependencies:** Tasks 10, 13

---

### Task 17: HML ground truth V1–V9 (escrita, SOMENTE HML) — job de medição
**Files to change:**
- `src/backend/jobs/probe-hml-vinculo-codbar-v1.ts` (novo; reaproveita `jobs/hmlEnvFile.ts` e as peças de `probe-hml-validacao-codbar.ts`, `probe-hml-editar-item-codbar.ts`, `probe-hml-item-variantes.ts` da branch `origin/chore/sispag-hml-bind-experimentos`)
- `ontology/_inbox/sispag-passo2-vinculo-codbar-hml-achados.md` (registro bruto V1–V9, um bloco por caso: request mascarado, `status`, corpo, releitura)
- `ontology/business-rules/vinculo-codbar-item-sispag.md` (via OntologyCurator: trocar "assumido/a provar" de I17i e o status das premissas pelo resultado medido)

**Acceptance criteria:**
- [ ] Roda **somente em HML**: o job **recusa** executar se a base URL não terminar em `-hml` (checagem explícita, igual aos harnesses); credenciais por `HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env`; **nunca** `.env` de produção; `databaseConnectionString=""` para não gravar sessão em `columbia-default` (memórias: HML recusa usuário de PRD; sessão do robô contaminável)
- [ ] Apenas códigos de barras **sintéticos** com DV válido gerados no job, sem relação com boleto real; título/lote de teste do HML; nenhum dado de PRD; só o mascarado 5+4 em console, arquivo ou achados
- [ ] Usa o **client de produção** (`ConexosSispagWriteClient` da Task 7) e o `VinculoCodigoBarrasService`, não só o probe cru (V1 exige isso)
- [ ] **V1:** ≥ 3 itens no mesmo lote (1 DDA do ERP + 2 vinculados), guarda I16 sobre o conjunto, `finalizar`, `gerarRemessa`, decodificação do `.REM` (segmento J com barra/valor/data)
- [ ] **V2:** `PUT` repetido com o mesmo payload (200 e item igual); `PUT` em item que já tem a barra
- [ ] **V3:** edição por outro caminho entre a leitura e o `PUT`; o que a releitura mostra (alimenta `ItemEditadoPorTerceiroError`)
- [ ] **V4:** após o `PUT`, modalidade do item (6 mesmo banco × 7 outro banco) e o segmento J do `.REM` para banco emissor ≠ banco pagador (237 com conta 341)
- [ ] **V5:** `PUT` em lote **FINALIZADO** (confirma ou invalida I17i)
- [ ] **V6 (unknowns):** o boleto no pool `fin124` depois do pagamento por vínculo reaparece "livre"? (risco de reuso entre lotes); registrar o que **não** foi observável em HML (retorno bancário não existe) em vez de concluir
- [ ] **V7:** barras com layout de 237/104/329, `splitCodBar` correto; **V8:** título com desconto/acréscimo (`totalAberto` ≠ valor); **V9:** barra com vencimento = `dataDebito` e = título + 5 dias (R1/R2 do `finalizar`)
- [ ] Limpeza: o job cancela/descarta os lotes sintéticos ao final ou registra os `flpCod` órfãos para descarte manual (a API não apaga rascunho)
- [ ] Qualquer resultado que contradiga a ontologia (ex.: modalidade errada em V4, `PUT` aceito em lote finalizado em V5) **reabre** as Tasks 10/12 como P0; o `on` em PRD fica proibido enquanto V1–V9 não estiverem registrados
- [ ] Execução com **uma** sessão, fora de horário de analista (memória: cap de sessões do HML)

**Dependencies:** Tasks 7 e 10 (client e service). Independente das demais: roda em paralelo; **conclui antes do Ship**.

---

### Task 18: Sonda PRD **somente leitura** de permissão do robô (job separado)
**Files to change:**
- `src/backend/jobs/probe-prd-readonly-permissao-fin015.ts` (novo)
- `ontology/_inbox/sispag-passo2-vinculo-codbar-sonda-prd.md` (registro do resultado, quando executada)

**Acceptance criteria:**
- [ ] **Nunca escreve**: o job não importa `editarItemDoRascunho`, `confirmarCodigoBarras`, `removerItemDoRascunho`, `importarTitulos`, `criarLote`, `finalizarLote` nem `gerarRemessa` (teste estático que lê o fonte do job e falha se qualquer um aparecer); só `GET`/`list` de `fin015/finItemSispag` e leituras já usadas
- [ ] Cobre apenas: `list` de itens de um rascunho PRD **existente** (permissão já usada), e — **somente se** a Conexos/Columbia confirmar que não tem efeito (ver Q7) — `validacao/codigoBarras`, que é decodificador; **não** inclui `confirmaCodigoBarras` nem `PUT`. Resultado documentado como **"não é prova de permissão de `PUT`"** (V-PRD1 continua aberto)
- [ ] Alternativa preferida registrada no cabeçalho do job: pedir à Conexos/Columbia a **matriz de permissões do robô para o programa `fin015`** em vez de sondar às cegas
- [ ] **Efeito colateral documentado no `--help`, no cabeçalho do arquivo e no achado:** o login do job **substitui a sessão viva do robô** (cap de sessões; memória "Probe local derruba sessão Conexos"); `listGenericPaginated` é página única — conferir `count`. Por isso exige flag explícita `--eu-entendo-que-derruba-a-sessao-do-robo` e **só roda com o go do maintainer**, fora de horário de analista; o executor do pipeline **não** o dispara
- [ ] `databaseConnectionString=""` (não grava sessão em `columbia-default`); credencial de PRD só do ambiente do maintainer, nunca em arquivo versionado
- [ ] Saída mascarada: nenhuma linha digitável, nenhum nome de favorecido além do necessário

**Dependencies:** Task 7. **Execução depende de aprovação explícita do maintainer** (não é gate automático do loop).

---

### Task 19: Documentação e gotcha
**Files to change:**
- `DEPLOY.md` (variável `SISPAG_BIND_CODBAR_FILIAIS`, default `off`, kill-switch)
- `CLAUDE.md` (uma linha em "Gotchas": *vínculo de código de barras só no rascunho; `PUT` nunca em lote finalizado; `shadow` não faz chamada ao ERP*)
- `docs-contexto/03_ontologia_financeiro.md` (se citar sugestão/passos)

**Acceptance criteria:**
- [ ] Texto cita a ordem de rollout (HML → sonda → shadow → 1 título) e que `on` em PRD exige V-PRD1/V-PRD2
- [ ] `docs/regis-review/*` **não** editados (relatórios datados)

**Dependencies:** Tasks 3, 13

---

## Ordem TDD

`1 → 2` · `3` (paralelo) · `4 → 8` · `5` (paralelo) · `6 → 7` · `9 → 10 → 11 → 12 → 13` · `14 → 15` · `16` · `17` (paralela a 11–15; conclui antes do Ship) · `18` (somente com o go do maintainer) · `19`.
Cada par RED/GREEN é commitado separado. Nada de Terraform nem `infra/` (inexistente): **AwsInfraArchitect não é acionado**. Nenhum handler/job de produção novo (os jobs das Tasks 17–18 são probes manuais): **ObservabilityAdvisor não é acionado**.

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend e frontend)
- [ ] `npm run lint` ✅ (backend e frontend)
- [ ] `npm test` ✅ (inclui testes da migration 0086 e paridade de cópia no build)
- [ ] PatternGuardian gate ✅ (revisa arquivo inteiro: conferir P0 fora do delta contra `main` antes de remediar)
- [ ] entity_changed: ontology diff presente (6f21242); ao fim, via OntologyCurator: `implementation_status: planned → implemented` em I17, ação, emendas, `_index.json`, `_coverage.json`, `_watchlist.md`, `last_review` ✅
- [ ] Frontend tocado: DesignSystemReviewer gate ✅
- [ ] Task 17 (HML V1–V9) registrada e refletida na ontologia (premissas I17i/V4/V6 fechadas ou reabertas) ✅
- [ ] Task 18: sonda PRD **não executada pelo loop**; resultado, se existir, registrado; **V-PRD1/V-PRD2 permanecem abertos** e o código entrega `off`/`shadow` ✅
- [ ] GroundTruthValidator: n/a para escrita em PRD (sem leitura PRD equivalente sem efeito); validação = Task 17 + releitura embutida (I17e)
- [ ] Regis-Review reduzido (delta + ~4 QAs: fault-tolerance, security, integrability, testability) ✅; só P0 reentra; P1–P3 em `ontology/_inbox/sispag-passo2-vinculo-codbar-regis-followups.md`
- [ ] Rebase sobre `main` sem conflito; reconferir versão do app, número da migration, ADR e versão da ontologia em `main` antes de bumpar (versões colidem entre sessões paralelas)
- [ ] Delta tem `feat` em `src/` ⇒ bump de versão FE+BE em lockstep (minor, sugerido 0.68.0) **à mão nos dois `package.json`** (sem pwsh nesta máquina) + `CHANGELOG.md` ✅

## Perguntas abertas (P1, não bloqueiam o início; ★ decidem desenho)

- **Q1 ★ Cinco colunas × "3 colunas" no ADR.** O ADR-0071 e o §2.2 da proposta dizem "3 colunas nullable"; a entidade `lote-pagamento.md` (0.42.0) e o pedido listam **cinco** (`origem`, `decisao_id`, `codigo_mascarado`, `aplicado_em`, `flp_cod`). As tasks seguem a entidade (cinco). Corrigir o texto do ADR/proposta na revisão de ontologia?
- **Q2 ★ Fonte do `totalAberto` ao vivo.** I17b exige o aberto do `fin064` lido na remessa. `ConexosSispagClient` tem `lerSituacaoTitulo`/`getTituloAPagar` (≈ l.492/458); confirmar qual devolve `totalAberto` (e não `titMnyAberto`, l.607 usa fallback) e se o grid `titulosPendentes` do lote já o traz para evitar uma chamada por item.
- **Q3 ★ Ator/permissão do `PUT`.** O robô CLONEX escreve com a sessão do usuário do Conexos ou do robô? Memória: "usuário sem vínculo cai no robô em silêncio" e ações `fin010` foram liberadas parcialmente. O `PUT fin015/finItemSispag` é permissão separada? Resolve só com V-PRD1; hoje o código assume o mesmo contexto do `importar`.
- **Q4 ★ Idempotência do evento sem coluna `lote`.** A trilha 0084 não tem `lote_id`. Opções: (a) guardar `loteId` em `detalhe` e consultar por `detalhe->>'loteId'` (sem índice); (b) coluna `lote_id` + índice único parcial para `VINCULO_APLICADO` na 0086. Recomendação: (b), por ser a única forma de garantir "único por (lote, título, decisaoId)" sob concorrência. Confirmar.
- **Q5 Origem da marca de retenção na retirada por vínculo falho.** `BloqueioDuplicidade.origem` (0085) aceita `DUPLICIDADE_TITULO | CODIGO_BARRAS_REPETIDO | CODIGO_BARRAS_ILEGIVEL`. A retirada com `VINCULO_CODIGO_BARRAS_FALHOU` precisa de origem nova (CHECK da 0085 teria de ser ampliado na 0086) ou reusa `CODIGO_BARRAS_ILEGIVEL`? Recomendação: nova origem `VINCULO_CODIGO_BARRAS_FALHOU` ampliando o CHECK na 0086, para a tela distinguir "boleto repetido" de "vínculo falhou".
- **Q6 `Δ = 0` e a constante.** I17c diz "mesma constante global da I15c" mas `DIAS_DEPOIS_MIN = 1`; o `Δ = 0` com valor igual cai no tier (a) (|Δvalor| ≤ R$ 0,05, mesmo dia). Confirmar que a elegibilidade usa piso `0` próprio e **não** altera `DIAS_DEPOIS_MIN` (que mudaria o tier da sugestão).
- **Q7 ★ O que a sonda PRD pode tocar.** `validacao/codigoBarras` é decodificador (sem efeito observado em HML) mas é `POST`; `confirmaCodigoBarras` num rascunho existente pode registrar estado. A sonda deve incluir `validacao` ou limitar-se ao `list`? Recomendação: só `list` + pedido da matriz de permissões à Conexos; `validacao` apenas com ok explícito.
- **Q8 `shadow` e lotes `dryRun`.** Com `dryRunOverride`/`conexosDryRun`, `gerarRemessa` já não escreve; confirmar que `VINCULO_SIMULADO` é gravado (é só trilha local) ou se dry-run também silencia a trilha.
- **Q9 Lote com mais de 500 itens.** A releitura pagina (`maxPaginas = 40`), mas só 500/página foi exercitado em HML; leitura incompleta aborta (I17g(2)). Confirmar que lotes grandes passam a abortar o vínculo (não a retirar), como a guarda atual.
- **Q10 Quem consome `avisos`/`vinculados`.** O job externo (GitHub Actions) que chama a rota da remessa lê `avisos`? Hoje 200 + `avisos`; se o consumidor tratar 200 como "tudo certo", o vínculo/retirada passa despercebido (mesmo ponto da Q8 da remoção).
- **Q11 Desfazer da decisão com item vinculado em rascunho.** I17l manda só avisar. Aceitar sem bloqueio no `anularDecisao`, ou recusar a anulação enquanto houver item vinculado em lote `RASCUNHO`? A proposta escolhe aviso; registrar a escolha.
