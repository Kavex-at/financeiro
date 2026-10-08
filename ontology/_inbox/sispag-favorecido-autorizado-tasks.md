# Tasks: sispag-favorecido-autorizado

**Spec source:** ontology/_inbox/sispag-favorecido-autorizado-interview.md (+ `-ontology-diff.md`)
**Ontology diff:** yes — commit `b6d4310` (ADR-0065, v0.38.0): `entities/favorecido-autorizado.md`, `state-machines/{favorecido-autorizado,lote-pagamento}.md`, `business-rules/{favorecido-autorizado-sispag (I14), destino-pagamento-sispag (I10), verificacao-ted-pix-sispag (I13)}.md`, `actions/sispag/{solicitar,aprovar,rejeitar,revogar}-autorizacao-favorecido.md`, `verificar-destino-autorizado.md`, `listar-candidatos-autorizacao.md`; removidos `ExcecaoDestino`, `PendenciaCadastro`, `conferirLote`/`devolverLote`, `CANAL_HABITUAL`.
**Estimated scope:** XL (1 migração destrutiva, ~8 arquivos de domínio novos, ~25 arquivos de código + testes removidos, 1 tela nova + 1 relatório + retirada de 2 telas)

## Notas de escopo (ler antes de começar)

- **Layout:** `src/backend/` e `src/frontend/` (nunca `backend/src`). Sem `infra/` → AwsInfraArchitect **não** é acionado. Nenhum handler Lambda nem job novo → ObservabilityAdvisor **não** é acionado (o job `aposentar-excecoes-substituidas` é **removido**; `calcular-perfil-canal` fica intacto).
- **Número da migração:** `origin/main` e todas as branches locais/remotas terminam em `0079` (conferido em 2026-10-08 com `git fetch origin main`). Usar **`0080_sispag_favorecido_autorizado.sql`**. Reconferir no rebase (memória "versão colide entre sessões paralelas").
- **Cópia para `dist/`:** `migrations/copy-to-dist.ts` copia todo `NNNN_*.sql` do nível de cima via `MigrationFiles.list` — basta o nome seguir o padrão; **não** colocar o arquivo em subpasta. O rollback vai em `migrations/rollbacks/` (não é migração).
- **`ATOR_SISTEMA`** hoje mora em `ExcecaoSubstituicaoService.ts` e é importado por `RemessaService.ts`: mover para um módulo sobrevivente **antes** de apagar o serviço.
- **`sispag_verificacao_evento`** (trilha só-inclusão da ADR-0063) **não é alterada**: o `CHECK` mantém `PENDENCIA_*`, `LOTE_CONFERIDO`, `LOTE_DEVOLVIDO`, `CONFERENCIA_LIMPA` para as linhas históricas; o código simplesmente para de emiti-los. A retirada por autorização usa o `ITEM_REMOVIDO_SISTEMA` existente com `dados.motivo ∈ {SEM_DADO_PAGAMENTO, FAVORECIDO_NAO_AUTORIZADO, DESTINO_ALTERADO}`.
- **Duplicidade (I13c–h)** fica inalterada; não tocar `DuplicateDetector`, `DuplicateResolutionService` além de remover referências a conferente.
- Paralelismo: tarefas marcadas `[paralela com Tn]` podem rodar em worktrees/agentes separados; as demais seguem a ordem numérica.

## Task list

### Task 1: Write failing tests for the authorized-payee core (migration, state machine, fingerprint, mask)
**Files to change:**
- `src/backend/migrations/0080_sispag_favorecido_autorizado.test.ts` (novo — leitura estática do SQL, padrão de `0079_*.test.ts`)
- `src/backend/migrations/0080_sispag_favorecido_autorizado.integration.test.ts` (novo — padrão de `0075_*.integration.test.ts`)
- `src/backend/domain/libs/sispag/AuthorizedPayeeRule.test.ts` (novo)
- `src/backend/domain/libs/sispag/PayeeFingerprint.test.ts` (novo)
- `src/backend/domain/libs/sispag/MaskDestino.test.ts` (atualizar para o formato I14l)

**Acceptance criteria:**
- [ ] Teste estático da 0080: cria `sispag_favorecido_autorizado` e `sispag_favorecido_autorizado_evento`; trigger da trilha recusa UPDATE/DELETE/TRUNCATE; índice único parcial em (`pes_cod`, `modalidade`) `WHERE estado IN ('PENDENTE','AUTORIZADO','REAPROVACAO_PENDENTE')`; `DROP TABLE` de `excecao_destino`, `excecao_destino_audit`, `lote_pagamento_item_destino_audit`, `pendencia_cadastro_origem`, `pendencia_cadastro`; dropa colunas de conferência/devolução de `lote_pagamento` e `excecao_destino_id`/`destino_manual`/`destino_origem` de `lote_pagamento_item`; adiciona `favorecido_autorizado_id`; catálogo de permissões sem `sispag:excecao`/`sispag:conferir`/`sispag:cadastro` e com `sispag:autorizar_favorecido`; `alerta_tipo_check` sem `sispag-excecao-divergencia` e com `sispag-destino-alterado`; `alerta_item_lote` `CHECK` sem `CANAL_HABITUAL`
- [ ] Teste de integração da 0080 (Postgres de teste): com 1 linha em `excecao_destino` **ou** `excecao_destino_audit` **ou** `lote_pagamento_item_destino_audit` **ou** `lote_pagamento_item.destino_manual IS NOT NULL`, a migração lança e nada é alterado (transação inteira); com tabelas vazias aplica; concessões de `sispag:excecao` (papel e usuário) viram `sispag:autorizar_favorecido`; `Administrador` recebe `sispag:autorizar_favorecido`; concessões de `sispag:conferir`/`sispag:cadastro` somem; reaplicar é no-op
- [ ] `AuthorizedPayeeRule.test.ts` cobre F1–F7 da `state-machines/favorecido-autorizado.md`: transições válidas, terminais `REJEITADO`/`REVOGADO` recusam tudo, F6 sem `solicitadoPor` → `PayeeReapprovalNotConfirmedError`, aprovador = solicitante → `PayeeApprovalBySolicitorError`, motivo obrigatório em F3/F7, F4 não dispara com `FALHA_LEITURA` nem com sem dado, F4 só compara na mesma `fingerprintChaveId`
- [ ] `PayeeFingerprint.test.ts`: mesmo destino normalizado → mesmo HMAC; TED difere por qualquer um de banco/agência/DV/conta/DV; PIX difere por tipo ou chave; normalização (zeros à esquerda, caixa, pontuação de CPF/CNPJ/telefone) estável; devolve `{ fingerprint, keyId }`; chave diferente → fingerprint diferente; nunca expõe o valor bruto
- [ ] `MaskDestino.test.ts`: TED mostra banco e agência completos e só os 4 últimos dígitos da conta; PIX mostra tipo + trecho; nenhuma saída contém a conta/chave completa
- [ ] Todos os testes novos **falham** (red) antes das Tasks 2–4

**Dependencies:** none

---

### Task 2: Migration 0080 — authorized-payee tables, guarded drops, permission catalog, alert types
**Files to change:**
- `src/backend/migrations/0080_sispag_favorecido_autorizado.sql` (novo)
- `src/backend/migrations/rollbacks/0080_sispag_favorecido_autorizado.rollback.sql` (novo — recria só a estrutura vazia das tabelas/colunas dropadas e o catálogo antigo; documentado como "dados não são reconstruíveis por construção: a guarda exigiu 0 linhas")

**Acceptance criteria:**
- [ ] Bloco `DO $$` **no início** conta linhas de `excecao_destino`, `excecao_destino_audit`, `lote_pagamento_item_destino_audit` e `lote_pagamento_item WHERE destino_manual IS NOT NULL` (com `to_regclass` para tolerar tabela já dropada) e faz `RAISE EXCEPTION` com as contagens se qualquer uma > 0 (ADR-0065 §4)
- [ ] `pendencia_cadastro`/`pendencia_cadastro_origem`: `RAISE WARNING` com a contagem antes do drop (ADR não a inclui na guarda; ver Riscos)
- [ ] Cria `sispag_favorecido_autorizado` com as colunas da entidade (`pes_cod`, `credor`, `modalidade CHECK IN ('TED','PIX')`, `estado CHECK`, `fingerprint`, `fingerprint_chave_id`, `destino_mascarado`, `avisos JSONB`, `fingerprint_observado`, `destino_observado_mascarado`, `origem_solicitacao CHECK IN ('ITEM','RELATORIO','MANUAL')`, `solicitado_por/em`, `decidido_por/em`, `motivo_decisao`, `ultima_conferencia_em/resultado CHECK`, `versao`), `CHECK (estado <> 'AUTORIZADO' OR fingerprint IS NOT NULL)`; índice único parcial de vigência
- [ ] Cria `sispag_favorecido_autorizado_evento` (id, autorizacao_id FK, evento `CHECK IN ('SOLICITADO','CONFIRMADO','APROVADO','REJEITADO','REAPROVACAO_ABERTA','REVOGADO','DESTINO_REVELADO','CONFERIDO')`, ator, ocorrido_em, dados JSONB) + função/trigger só-inclusão (UPDATE/DELETE/TRUNCATE), padrão da 0078
- [ ] `lote_pagamento_item`: `ADD COLUMN favorecido_autorizado_id UUID NULL`; `DROP COLUMN excecao_destino_id, destino_manual, destino_origem` (+ `DROP CONSTRAINT lote_pagamento_item_destino_origem_check`); `lote_pagamento`: `DROP COLUMN conferido_por, conferido_em, devolvido_por, devolvido_em, motivo_devolucao`
- [ ] `DROP TABLE` das 5 tabelas + funções/triggers só-inclusão da 0067/0075; `alerta_item_lote`: `DELETE ... WHERE tipo='CANAL_HABITUAL'` (informativa, ADR-0065 I13i) e `CHECK (tipo IN ('DUPLICIDADE_FORTE','DUPLICIDADE_FRACA'))`
- [ ] Permissões: migra concessões `sispag:excecao` → `sispag:autorizar_favorecido` (papel e usuário, `ON CONFLICT DO NOTHING`), apaga `sispag:excecao`/`sispag:conferir`/`sispag:cadastro`, troca os dois `CHECK` pelo catálogo novo, concede ao `Administrador`; `alerta_tipo_check` troca `sispag-excecao-divergencia` por `sispag-destino-alterado` (apaga alertas do tipo antigo antes)
- [ ] Idempotente (`IF EXISTS`/`IF NOT EXISTS`); testes da Task 1 de migração verdes; `npm run build` deixa `dist/migrations/0080_sispag_favorecido_autorizado.sql` (conferir com `ls`)

**Dependencies:** Task 1 · [paralela com Task 3]

---

### Task 3: Config and catalogs — feature flag, HMAC key, permissions, alert type; drop exception flags
**Files to change:**
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` + `.test.ts`
- `src/backend/domain/interface/auth/Permission.ts`
- `src/backend/domain/interface/operacao/Alerta.ts`
- `src/backend/domain/interface/perfil/AtividadeUsuarioInterface.ts`, `src/backend/domain/repository/perfil/AtividadeUsuarioRepository.ts` (rótulos de atividade de exceção/conferência)
- `src/backend/domain/service/auth/EffectivePermissionCalculator.test.ts`
- `src/backend/.env.example` (se existir) e `DEPLOY.md` (seção de env)

**Acceptance criteria:**
- [ ] Novas envs: `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED` (default **false**), `SISPAG_FAVORECIDO_FINGERPRINT_KEY` (segredo, nunca logado) e `SISPAG_FAVORECIDO_FINGERPRINT_KEY_ID` (default `v1`), validadas com Zod no `EnvironmentProvider`
- [ ] Flag `true` sem chave (ou chave < 32 bytes) → `sispagFavorecidoAutorizadoEnabled` resolve `false` (falha fechada, I14k) e o provider registra o motivo — **sem** colocar diagnóstico no `bootstrapAppContainer` (gotcha dos ~58 jobs)
- [ ] Removidos `sispagExcecaoDestinoEnabled`, `SISPAG_EXCECAO_DESTINO_ENABLED` e o alias `SISPAG_DESTINO_MANUAL_ENABLED`; `rg 'EXCECAO_DESTINO_ENABLED|DESTINO_MANUAL_ENABLED' src/` vazio
- [ ] `PERMISSION`: sai `SISPAG_EXCECAO`, `SISPAG_CONFERIR`, `SISPAG_CADASTRO`; entra `SISPAG_AUTORIZAR_FAVORECIDO = 'sispag:autorizar_favorecido'`; lista idêntica ao `CHECK` da 0080 (teste compara)
- [ ] `ALERTA_TIPO`: sai `SISPAG_EXCECAO_DIVERGENCIA`, entra `SISPAG_DESTINO_ALTERADO: 'sispag-destino-alterado'`
- [ ] `npm run typecheck` aponta apenas os usos a remover nas Tasks 7–10 (esperado nesta etapa); testes do provider verdes

**Dependencies:** Task 1 · [paralela com Task 2]

---

### Task 4: Domain core — AuthorizedPayee interface, state-machine rule, fingerprint, mask, errors
**Files to change:**
- `src/backend/domain/interface/sispag/AuthorizedPayeeInterface.ts` (novo: `AUTHORIZED_PAYEE_STATE`, `PAYEE_CHECK_RESULT` = `OK|SEM_DADO_PAGAMENTO|FAVORECIDO_NAO_AUTORIZADO|DESTINO_ALTERADO|FALHA_LEITURA`, Zod do registro)
- `src/backend/domain/libs/sispag/AuthorizedPayeeRule.ts` (novo, `@injectable`, puro)
- `src/backend/domain/libs/sispag/PayeeFingerprint.ts` (novo, `@singleton @injectable`, `node:crypto` HMAC-SHA256, chave via `EnvironmentProvider`)
- `src/backend/domain/libs/sispag/MaskDestino.ts`
- `src/backend/domain/errors/{PayeeNotAuthorizedAtRemittanceError,PayeeApprovalBySolicitorError,PayeeReapprovalNotConfirmedError,PayeeDestinationChangedSinceShownError,PayeeWithoutPaymentDataError,BatchEmptiedByCheckError}.ts` (novos)

**Acceptance criteria:**
- [ ] Testes `AuthorizedPayeeRule`, `PayeeFingerprint`, `MaskDestino` da Task 1 verdes
- [ ] Precedência de `PAYEE_CHECK_RESULT` (I14d) implementada numa função pura testada: `FALHA_LEITURA` > `SEM_DADO_PAGAMENTO` > `FAVORECIDO_NAO_AUTORIZADO` > `DESTINO_ALTERADO`
- [ ] Mensagens de erro em português, sem destino completo (I10h/I14j); HTTP: 409/403/409/409/422/409 conforme a tabela de I14 e `BatchEmptiedByCheckError` 409
- [ ] Estados e resultados como constantes tipadas (nada de string crua); classes exportadas, métodos arrow, modificadores explícitos
- [ ] `npm run lint` verde nos arquivos novos

**Dependencies:** Task 3

---

### Task 5: AuthorizedPayeeRepository (+ insert-only event trail)
**Files to change:**
- `src/backend/domain/repository/sispag/AuthorizedPayeeRepository.ts` (novo) + `.test.ts` + `.integration.test.ts`

**Acceptance criteria:**
- [ ] Métodos: `buscarVigente(pesCod, modalidade)`, `buscarPorId`, `listar(filtro estado/pesCod)`, `listarVigentesPorPesCods(pesCods[])` (uma query, para verificação em lote e relatório), `inserir`, `atualizarComVersao(id, versaoEsperada, patch, tx)` → linhas afetadas, `registrarEvento(evento, tx)`
- [ ] SQL 100% parametrizado (`$1…`); `atualizarComVersao` com `WHERE id=$1 AND versao=$2` e `versao = versao + 1`
- [ ] Violação do índice único parcial (`23505`) traduzida para erro de domínio de "já existe autorização vigente" (409)
- [ ] Integração: evento não pode ser alterado nem apagado (trigger); nenhuma coluna guarda conta/chave completa
- [ ] `npm test` do arquivo verde

**Dependencies:** Task 2, Task 4

---

### Task 6: AuthorizedPayeeService — request/confirm, approve, reject, revoke, check, re-check, audited reveal
**Files to change:**
- `src/backend/domain/service/sispag/AuthorizedPayeeService.ts` (novo) + `.test.ts`
- `src/backend/domain/appContainer.ts` (registro, se necessário)

**Acceptance criteria:**
- [ ] `solicitar({pesCod, modalidade, origem, ator})`: F1 (cria `PENDENTE`) ou F5 (confirma `REAPROVACAO_PENDENTE` gravando `solicitadoPor`); nunca cria `AUTORIZADO`; evento `SOLICITADO`/`CONFIRMADO`
- [ ] `aprovar({id, fingerprintMostrado, versao, ator})`: ator ≠ `solicitadoPor` (id autenticado) → senão `PayeeApprovalBySolicitorError`; lê o `cmn025` ao vivo pelo `DestinoPagamentoResolver`; sem dado → `PayeeWithoutPaymentDataError`; fingerprint atual ≠ mostrado → `PayeeDestinationChangedSinceShownError`; grava fingerprint + `keyId` + máscara + avisos (`PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO` quando a chave PIX não é o CPF/CNPJ do favorecido); evento `APROVADO`
- [ ] `rejeitar`/`revogar` exigem motivo não vazio; evento correspondente
- [ ] `verificarDestinoAutorizado(itens[])` (função única I14d): devolve resultado por item, usa **uma** leitura de cadastro por `pesCod` (cache do resolver) e uma query de autorizações; `DESTINO_ALTERADO` aplica F4 (grava observado, limpa `solicitadoPor`, evento `REAPROVACAO_ABERTA` com antes × agora mascarados) e emite `Alerta` `SISPAG_DESTINO_ALTERADO` com dedup `pesCod`+`modalidade`; `FALHA_LEITURA` não altera estado
- [ ] `reconferir(id)`: chama a verificação, atualiza `ultimaConferenciaEm/Resultado` (`IGUAL|DIFERENTE|SEM_DADO|FALHA_LEITURA`), evento `CONFERIDO`
- [ ] `revelar(id, ator)`: lê ao vivo do `cmn025`, devolve o destino completo **só na resposta**, grava evento `DESTINO_REVELADO` (sem o valor); nada de destino completo em `LogService`/eventos/erros (teste espiona o logger)
- [ ] Concorrência: versão divergente → `LoteVersaoConflitoError`-equivalente 409; testes unitários com repositório e resolver mockados cobrem todos os ramos acima

**Dependencies:** Task 5, Task 7 (resolver só-cadastro)

---

### Task 7: Resolver cadastro-only and removal of destination-exception code
**Files to change:**
- `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts` + `.test.ts`
- Mover `ATOR_SISTEMA` para `src/backend/domain/interface/sispag/SispagInterface.ts` (ou módulo equivalente) e ajustar import em `RemessaService.ts`
- Remover: `src/backend/domain/service/sispag/{ExcecaoDestinoService,ExcecaoSubstituicaoService}.ts` (+ testes/integração), `src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts` (+ testes), `src/backend/domain/libs/sispag/{ExcecaoDestinoRule,DestinoManualValidator}.ts` (+ testes), `src/backend/domain/interface/sispag/DestinoManualSchema.ts`, `src/backend/domain/errors/{ExcecaoDesabilitadaError,ExcecaoSemPermissaoError}.ts`, `src/backend/jobs/aposentar-excecoes-substituidas.ts`, `src/backend/jobs/probe-destino-manual-uso.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts` (tipos de exceção, `destinoOrigem`, `excecaoDestinoId`)

**Acceptance criteria:**
- [ ] Teste de regressão escrito antes: resolver com favorecido sem conta/chave no cadastro devolve "nenhum" mesmo se houvesse exceção (o passo 2 deixou de existir); PIX segue ordem I10k; TED usa a conta default
- [ ] Resolver expõe o destino normalizado necessário ao fingerprint (sem persistir) e a máscara I14l
- [ ] `rg -l 'ExcecaoDestino|excecao_destino|excecaoDestino|DestinoManual|destino_manual|aposentarExcec' src/backend` só retorna migrações antigas (`migrations/00[0-7]*`) e a 0080
- [ ] `package.json` e `.github/workflows/*` sem referência aos jobs removidos
- [ ] `npm run typecheck` sem erros vindos destes arquivos (os de lote/remessa/rotas são tratados nas Tasks 8–10)

**Dependencies:** Task 3 · [paralela com Tasks 4–5]

---

### Task 8: Lot flow — modality warning, finalizarLote removes and finalizes, no conference, no pendência, no CANAL_HABITUAL
**Files to change:**
- `src/backend/domain/service/sispag/VerificacaoTedPixService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoApiView.ts`
- `src/backend/domain/service/sispag/SispagPainelService.ts` + `.test.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` + `.test.ts`
- `src/backend/domain/repository/sispag/AlertaItemLoteRepository.test.ts`, `src/backend/domain/repository/sispag/VerificacaoTedPix.integration.test.ts`
- `src/backend/domain/service/sispag/DuplicateResolutionService.test.ts` (só referências a conferente)
- `src/backend/domain/interface/sispag/SispagInterface.ts` (`ITEM_ALERT_TYPE` sem `CANAL_HABITUAL`; `LotePagamento` sem conferência; `ItemLote.favorecidoAutorizadoId`, `autorizacaoAviso`)
- Remover: `src/backend/domain/service/sispag/{ConferenciaLoteService,PendenciaCadastroService}.ts`, `src/backend/domain/repository/sispag/PendenciaCadastroRepository.ts`, `src/backend/domain/libs/sispag/ConferenciaLoteRule.ts`, `src/backend/domain/errors/{ConferenceRequiredError,SelfConferenceError,ReturnReasonRequiredError,ItemsRemovedByCheckError}.ts` (+ testes)

**Acceptance criteria:**
- [ ] Regressão escrita antes (red): (a) `atualizarModalidadeItem` TED/PIX de favorecido não autorizado **não retira** o item e o devolve com `autorizacaoAviso = FAVORECIDO_NAO_AUTORIZADO`; (b) `finalizarLote` com 3 itens, 1 não autorizado → lote `FINALIZADO` com 2 itens, resposta lista o retirado com motivo, evento `ITEM_REMOVIDO_SISTEMA` com `dados.motivo`; (c) todos retirados → lote fica `RASCUNHO`, retiradas gravadas, `BatchEmptiedByCheckError`; (d) item `FALHA_LEITURA` → `PaymentCheckPendingError`, nada retirado por ele; (e) duplicidade aberta continua barrando (`PendingDuplicateAlertError`) e as retiradas já feitas permanecem; (f) `reabrirLote` não toca conferência
- [ ] Com `sispagFavorecidoAutorizadoEnabled = false`: `atualizarModalidadeItem` para TED/PIX é recusado (422/409 nomeado) e `modalidades-disponiveis` não oferece TED/PIX (I14k), mesmo com `SISPAG_TED_ENABLED`/`SISPAG_PIX_ENABLED` ligados
- [ ] Verificação TED/PIX não cria `CANAL_HABITUAL` nem `PendenciaCadastro`; `PerfilCanalFornecedor` não é mais lido por ela
- [ ] `rg -l 'PendenciaCadastro|pendencia_cadastro|Conferencia|conferido|devolvido|CANAL_HABITUAL|ItemsRemovedByCheck|exigeConferencia' src/backend --glob '!migrations/00[0-7]*'` só retorna a 0080 e os eventos históricos documentados
- [ ] Mensagem de `SEM_DADO_PAGAMENTO` contém "pedir ao responsável pelo cadastro do Conexos"
- [ ] `npm test` dos arquivos tocados verde

**Dependencies:** Task 6, Task 7

---

### Task 9: gerarRemessa L8 guard (only without native lot) and freeze of favorecidoAutorizadoId
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` + `.test.ts`

**Acceptance criteria:**
- [ ] Regressão escrita antes: lote `FINALIZADO` com item TED cujo favorecido foi revogado, **sem** lote nativo no ledger → `PayeeNotAuthorizedAtRemittanceError` (409) listando o item e o motivo, **zero** chamadas de escrita ao Conexos e nenhuma linha nova no ledger
- [ ] Mesmo cenário **com** lote nativo já criado (retomada ADR-0039) → guarda não roda; segue o destino congelado (I10f/I14g)
- [ ] `FALHA_LEITURA` no pré-voo também barra (falha fechada, I14f); `DESTINO_ALTERADO` dispara F4 via `AuthorizedPayeeService`
- [ ] Removidas a guarda `exigeConferencia`/`conferidoPor`, `excecaoRule`, `excecoes`, `registrarUsoDaExcecao`, `FlagsDestino.excecao` e `excecaoId` do schema de marca d'água; o congelamento grava `favorecido_autorizado_id` no item (só id)
- [ ] Boleto nunca passa pela guarda (teste); remessa só-boleto inalterada (fixtures CNAB existentes verdes)

**Dependencies:** Task 6, Task 7 · [paralela com Task 8 — arquivos disjuntos; se ambas tocarem `SispagInterface.ts`, serializar o merge]

---

### Task 10: Routes — authorized-payee API, candidates report, removal of conference/exception/pendência routes
**Files to change:**
- `src/backend/routes/sispag.ts` + `src/backend/routes/sispag.test.ts`, `src/backend/routes/sispag.verificacao.test.ts`
- `src/backend/routes/sispag.favorecidos.test.ts` (novo)
- `src/backend/http/routePermissions.test.ts`
- `src/backend/http/schemas.ts` (Zod dos corpos novos)
- `src/backend/domain/service/sispag/AuthorizationCandidatesService.ts` (novo, read-only) + `.test.ts`
- `src/backend/domain/repository/sispag/PerfilCanalFornecedorRepository.ts` (consulta do relatório, se faltar)

**Acceptance criteria:**
- [ ] Novas rotas com permissão e Zod: `GET /sispag/favorecidos-autorizados` (`sispag:ver`), `POST /sispag/favorecidos-autorizados` (`sispag:executar`; também confirma reaprovação), `POST /:id/aprovar` · `/:id/rejeitar` · `/:id/revogar` · `POST /:id/revelar` (`sispag:autorizar_favorecido`), `POST /:id/reconferir` (`sispag:ver`), `GET /:id/eventos` (`sispag:ver`), `GET /sispag/favorecidos-autorizados/candidatos` (`sispag:ver`)
- [ ] O `ator` vem sempre do usuário autenticado (nunca do corpo); teste prova que o corpo não sobrescreve
- [ ] Relatório de candidatos: por favorecido pago por TED/PIX ou com perfil `TED_PIX` — `pesCod`, credor, grupo dominante, participação, nº pagamentos, meses, confiança, tem conta/chave no `cmn025`, estado da autorização por modalidade, e seção "TED/PIX retirados por falta de dado" (de `ITEM_REMOVIDO_SISTEMA`); **nenhuma** escrita (teste com repositórios espiões); leitura de cmn025 com cache por `pesCod`
- [ ] Removidas `POST /lotes/:id/conferir`, `/lotes/:id/devolver`, `GET /pendencias-cadastro`, todas as `/excecoes*`; `routePermissions.test.ts` atualizado e verde
- [ ] Mapeamento de erros: os 6 erros novos → status da Task 4; `finalizar` responde 200 com `retirados[]` quando houve retirada
- [ ] `GET /lotes/:id/modalidades-disponiveis` respeita a flag (I14k)

**Dependencies:** Task 8, Task 9

---

### Task 11: Frontend API client, permissions and navigation
**Files to change:**
- `src/frontend/lib/sispag.ts` + `src/frontend/lib/sispag.test.ts`, `src/frontend/lib/sispag.verificacao.test.ts`
- `src/frontend/lib/permissoes.ts`, `src/frontend/__tests__/permissoes-api.test.ts`
- `src/frontend/components/nav/app-nav.tsx` + `.test.tsx`
- `src/frontend/app/perfil/alvo.test.ts`

**Acceptance criteria:**
- [ ] Funções tipadas para todas as rotas da Task 10 (Zod na resposta); removidas as de conferência/exceção/pendência
- [ ] Permissões do front espelham o catálogo novo (`sispag:autorizar_favorecido`; sem `excecao`/`conferir`/`cadastro`)
- [ ] Nav: some "Exceções de destino" e "Pendências de cadastro"; entra "Favorecidos autorizados" (visível com `sispag:ver`)
- [ ] `npm test` e `npm run typecheck` do frontend verdes nestes arquivos

**Dependencies:** Task 10

---

### Task 12: Frontend — authorized-payee screen (request, approve, reject, revoke, re-check, audited reveal)
**Files to change:**
- `src/frontend/app/sispag/favorecidos-autorizados/page.tsx` + `page.test.tsx` (novos)
- `src/frontend/app/sispag/favorecidos-autorizados/components/*` (tabela, `SolicitarAutorizacaoDialog`, `DecidirAutorizacaoDialog` com antes × agora, `RevogarAutorizacaoDialog`, `RevelarDestinoButton`, `SeloConferencia`) + testes

**Acceptance criteria:**
- [ ] Lista por estado com destino **mascarado** e selo "igual ao Conexos (lido HH:MM) · igual ao aprovado em DD/MM por X" / "diferente do aprovado" (I14l)
- [ ] Aprovar/rejeitar/revogar/revelar só aparecem com `sispag:autorizar_favorecido`; botão aprovar desabilitado quando o usuário é o solicitante (o backend continua sendo a guarda); aprovação envia o `fingerprintMostrado`; 409 de destino mudado recarrega e explica
- [ ] Reaprovação mostra antes × agora mascarados e exige "confirmar pedido" por `sispag:executar` antes de aprovar
- [ ] "Revelar" busca sob demanda, mostra por tempo limitado, não grava em estado global/cache/localStorage (teste)
- [ ] Motivo obrigatório em rejeitar/revogar; textos em português; testes RTL verdes

**Dependencies:** Task 11 · [paralela com Tasks 13 e 14]

---

### Task 13: Frontend — candidates report (read-only, row action creates PENDENTE)
**Files to change:**
- `src/frontend/app/sispag/favorecidos-autorizados/candidatos/page.tsx` + `page.test.tsx` (novos; ou aba na tela da Task 12 — escolher a que o DS indicar)

**Acceptance criteria:**
- [ ] Tabela com as colunas do relatório (Task 10) e a seção "TED/PIX retirados por falta de dado"
- [ ] Ação de linha "Pedir autorização" (TED e/ou PIX) visível com `sispag:executar`, chama `POST /favorecidos-autorizados` com `origem=RELATORIO` e a linha passa a mostrar `PENDENTE`; nenhuma ação de aprovar nesta tela
- [ ] Sem destino completo em lugar nenhum da tela; testes verdes

**Dependencies:** Task 11 · [paralela com Tasks 12 e 14]

---

### Task 14: Frontend — lot item badge/warning, remove conference UI, exception screen and pendências queue
**Files to change:**
- `src/frontend/app/sispag/components/LoteCard.tsx` + `LoteCard.test.tsx`, `LoteCard.verificacao.test.tsx`
- `src/frontend/app/sispag/page.tsx` + `page.test.tsx`
- Remover: `src/frontend/app/sispag/components/ConferenciaLoteDialog.tsx` (+ teste), `src/frontend/app/sispag/excecoes/**`, `src/frontend/app/sispag/pendencias-cadastro/**`

**Acceptance criteria:**
- [ ] Item TED/PIX mostra badge por `autorizacaoAviso` (`OK` neutro; `FAVORECIDO_NAO_AUTORIZADO`/`DESTINO_ALTERADO`/`SEM_DADO_PAGAMENTO` em aviso) com atalho "Pedir autorização" (`origem=ITEM`) quando cabe; `SEM_DADO_PAGAMENTO` orienta "pedir ao responsável pelo cadastro do Conexos"
- [ ] Após finalizar, toast/aviso lista os itens retirados e o motivo; lote esvaziado continua editável como RASCUNHO com a mensagem do `BatchEmptiedByCheckError`
- [ ] Sem selo/ação de conferência, sem badge `CANAL_HABITUAL`; `rg -l 'Conferencia|excecoes|pendencias-cadastro|CANAL_HABITUAL' src/frontend` vazio (fora de `node_modules`)
- [ ] Erro de remessa `PayeeNotAuthorizedAtRemittanceError` exibido por item no `GerarRemessaDialog`
- [ ] `npm test`, `npm run lint`, `npm run typecheck` do frontend verdes

**Dependencies:** Task 11 · [paralela com Tasks 12 e 13]

---

### Task 15: DesignSystemReviewer gate on the new/changed frontend
**Files to change:**
- (nenhum código novo; correções que o revisor apontar nos arquivos das Tasks 12–14)

**Acceptance criteria:**
- [ ] `DesignSystemReviewer` rodado sobre `src/frontend/app/sispag/favorecidos-autorizados/**`, `LoteCard.tsx`, `page.tsx`, `app-nav.tsx` sem violação bloqueante (tokens, classificação atômica, acessibilidade: tabelas com caption/rótulo para leitor de tela, botões com nome acessível, foco em diálogos)

**Dependencies:** Task 12, Task 13, Task 14

---

### Task 16: Ground-truth read-only check — resolver destination vs cmn025
**Files to change:**
- `src/backend/jobs/validate-sispag-favorecido-autorizado-v1.ts` (novo, read-only)

**Acceptance criteria:**
- [ ] Plano (GroundTruthValidator): fonte = `cmn025` (conta default / `cmnPessoasPix`) lido cru; amostra = até 20 `pesCod` do relatório de candidatos (perfil `TED_PIX` + pagos por TED/PIX), estratificada TED/PIX; chave = (`pesCod`, `modalidade`); comparação = destino normalizado escolhido pelo `DestinoPagamentoResolver` × destino derivado direto do payload cru segundo I10/I10k, e `fingerprint(resolver) == fingerprint(cru)`; tolerância **0** divergências
- [ ] Nenhuma escrita (nem no banco local nem no Conexos); roda com `databaseConnectionString=""` (memória: sessão do robô contaminável) e respeita o cap de sessões (uma sessão, sem paralelismo)
- [ ] Saída só com valores **mascarados**; resultado anexado ao PR; divergência > 0 = P0 de volta ao loop
- [ ] Não é cálculo monetário: o gate monetário do GroundTruthValidator **não se aplica**; este check substitui-o por decisão do TaskScoper (registrar no PR)

**Dependencies:** Task 7, Task 10

---

### Task 17: Ontology index/coverage sync and rollout notes
**Files to change:**
- `ontology/_index.json`, `ontology/_coverage.json` (`FavorecidoAutorizado`, `favorecido-autorizado` SM, I14, 6 ações → `implemented` com `impl_files`; I13 sem `open_gap`)
- `ontology/business-rules/favorecido-autorizado-sispag.md` (`related_files`, `has_canonical_test`)
- `DEPLOY.md` (passos: definir `SISPAG_FAVORECIDO_FINGERPRINT_KEY[_ID]` no Render e nos secrets dos crons que resolvem destino; flag segue `false` até a Columbia validar o relatório; conceder `sispag:autorizar_favorecido` pela tela de usuários)

**Acceptance criteria:**
- [ ] `_index.json` aponta só para arquivos que existem (`jq` + `test -f` em script)
- [ ] `_coverage.json` reflete o estado implementado; versão da ontologia **não** é confundida com a versão do app
- [ ] Runbook de rollout presente no `DEPLOY.md`

**Dependencies:** Task 10, Task 14

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (src/backend e src/frontend)
- [ ] `npm run lint` ✅ (src/backend e src/frontend)
- [ ] `npm test` ✅ (src/backend e src/frontend)
- [ ] PatternGuardian gate ✅
- [ ] [entity_changed=true] ontology diff in `ontology/` present ✅ (commit `b6d4310`)
- [ ] [frontend touched] DesignSystemReviewer gate ✅ (Task 15)
- [ ] [new handler/job] ObservabilityAdvisor review — **N/A** (nenhum handler/job novo; só remoção de job e script read-only de validação)
- [ ] [infra touched] AwsInfraArchitect — **N/A** (não há `infra/`)
- [ ] Ground-truth read-only check (Task 16) com 0 divergências ✅
- [ ] Migração 0080 aplicada num banco de teste com a guarda provada (falha com linha, passa vazio) ✅
- [ ] [delta has feat/fix in `src/`] app version bumped (FE+BE lockstep) — `bump-version.ps1` não roda nesta máquina: aplicar semver à mão nos dois `package.json` + `CHANGELOG.md`, conferindo a versão na `main` no rebase ✅
- [ ] Regis-Review gate ✅; rebase de `main` sem conflito pendente ✅

## Riscos e ambiguidades

1. **Guarda da migração vs. produção:** se `lote_pagamento_item_destino_audit` (ADR-0054, destino manual por item) tiver qualquer linha em prod, a 0080 falha no boot e o `BootMigrator`/crons param de migrar. Conferir a contagem em prod **antes** do merge (via `.env` local, sa-east-1 — não o MCP Supabase).
2. **`pendencia_cadastro` não está na guarda da ADR** — drop com `WARNING`. Se houver linhas em prod, a informação some; confirmar com o Yuri se deve entrar na guarda.
3. **Segredo HMAC:** a flag ligada sem chave fica desligada (falha fechada). A rotação exige recálculo assistido (fora de escopo); comparar só com a mesma `keyId`.
4. **Lotes `FINALIZADO` existentes** que aguardavam conferência passam a depender só da guarda L8; com TED/PIX desligados em prod, o impacto esperado é zero, mas a 0080 dropa as colunas de conferência sem olhar o conteúdo.
5. **Leituras ao vivo do `cmn025`** em aprovação, reconferência, revelação, relatório e verificação podem bater no limite de sessões do Conexos: tudo passa pelo cache por `pesCod` do resolver; o relatório não deve resolver destino de centenas de favorecidos de uma vez sem paginação.
