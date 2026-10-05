# Tasks: sispag-verificacoes-ted-pix

**Spec source:** ontology/_inbox/sispag-verificacoes-ted-pix-gap.md (seção "Resoluções", Q1–Q12) + ADR-0063 (`ontology/decisions/0063-sispag-verificacoes-ted-pix-duplicidade-conferencia.md`)
**Ontology diff:** yes — `ontology/decisions/0062-*.md`, `ontology/business-rules/verificacao-ted-pix-sispag.md` (I13a–m), `ontology/business-rules/destino-pagamento-sispag.md` (I10b revisado), `ontology/entities/{alerta-item-lote,bloqueio-duplicidade,pendencia-cadastro,perfil-canal-fornecedor}.md`, `ontology/actions/sispag/{verificar-itens-ted-pix,resolver-alerta-duplicidade,conferir-lote,devolver-lote,calcular-perfil-canal}.md`, `ontology/state-machines/lote-pagamento.md` (L12/L13; guards L3/L4/L8) — commit 094e312
**Estimated scope:** XL (4 migrations, 4 repositories novos + 2 alterados, 3 services novos + 3 alterados, 1 job + 1 workflow, 6+ rotas, 1 página nova + LoteCard/dialogs, 1 validate script)

> **Regras transversais (valem para toda task):**
> - **Fora de escopo:** envio/retorno automático via Nexxera do BPMN proposto. **Nada escreve no Conexos**
>   nesta feature (fin064/fin010/fin095/cmn025 só leitura).
> - Verificação **só** para itens `modalidade ∈ {TED, PIX}`. `BOLETO`, "a definir" e `CREDITO_CONTA` legado nunca.
> - **Falha fechada (I13b):** leitura do Conexos que falha deixa o item `verificacaoEstado = PENDENTE`; nunca
>   cria/descarta alerta, nunca retira item, nunca abre pendência por ausência.
> - Contraparte de duplicidade só **na filial do item** (Q2). Janela fin064: vencimento ≥ 2026-01-01, paginação real
>   (memória: `listGenericPaginated` é página única — conferir `count`); filtro por favorecido no servidor se o fin064
>   aceitar, senão em memória (Q3, confirmar na implementação e registrar no código).
> - Ator = **username canônico autenticado** (`req.user.sub`), nunca do body. Remoção pela verificação usa ator `sistema`.
> - Conta/chave **sempre mascaradas** (I10h) em log, `LogService.data`, trilha e resposta de API.
> - Identificadores e classes de erro em inglês; mensagens de log/erro ao operador em **português** (ADR-0042).
>   Classes exportadas, métodos arrow, modificadores explícitos, Zod nas bordas, SQL parametrizado (`$1..$n`),
>   `@injectable()`/`@singleton()`, `EnvironmentProvider` (nunca `process.env` em service). Status/tipos como
>   constantes tipadas (`ITEM_ALERT_TYPE`, `ITEM_ALERT_STATE`, `CHANNEL_GROUP`, ...).
> - **Migrations:** última hoje é `0075`; novas começam em **0076**. Reconfirmar contra `origin/main` antes do commit
>   (sessões paralelas colidem). Conferir `migrations/MigrationFiles.ts` e que o `.sql` aparece em `dist/` após
>   `npm run build` (gotcha do CLAUDE.md, incidente 2026-09-23).
> - Nenhuma concessão default das permissões novas na migration (Q8) — vira passo de rollout no PR.
> - Testes: TDD, vitest, colocados ao lado do fonte. Rodar com `cd src/backend && npm test` / `cd src/frontend && npm test`.
> - Scripts locais contra PRD: rodar com `databaseConnectionString=""` (memória: sessão do robô contaminável) e
>   lembrar que probe local pode derrubar uma sessão Conexos viva.

## Task list

### Task 1: Failing tests do núcleo de detecção (duplicidade, canal, perfil) — inclui caso canônico fil 4 docs 6173/6702
**Files to change:**
- `src/backend/domain/service/sispag/DuplicateDetector.test.ts` (novo)
- `src/backend/domain/service/sispag/ChannelProfileCalculator.test.ts` (novo)
- `src/backend/domain/service/sispag/__fixtures__/fin064-fil4-6173-6702.json` (novo, fixture anonimizada a partir da saída da `probe-duplicidade-titulos.ts`)

**Acceptance criteria:**
- [ ] Teste canônico: fixture fil 4 com docs 6173 e 6702 (mesmo favorecido, mesma NF) → um par `DUPLICIDADE_FORTE` com contraparte `(4, 6702)` para o item do 6173 e vice-versa
- [ ] FORTE: casa por `pesCod` com fallback `pesCodFor` quando `pesCod` vazio; NF normalizada (só dígitos, sem zeros à esquerda; vazio não casa); qualquer tipo de documento; inclui título **pago**
- [ ] FRACA: mesmo favorecido + mesmo valor em centavos + vencimento a ±N dias (N injetado, default 15); borda de 15 e 16 dias testada; inclui pagos (Q6)
- [ ] Par FORTE não gera também FRACA (I13d); títulos do mesmo `(filCod, docCod)` nunca são contraparte (I13e, parcelas)
- [ ] Contraparte de outra filial é ignorada (Q2)
- [ ] Perfil de canal: só casamento **único** baixa×débito (valor exato, data ±1,5 dia) conta; ambíguo descartado; grupos `BOLETO`/`TED_PIX`/`OUTROS` (PIX e TED/DOC/TRANSF → `TED_PIX`; tributo, SISPAG sem canal e o resto → `OUTROS`); confiança ALTA só com limiares (5/3/0.95 injetados); perfil chaveado por `pesCod` (Q4)
- [ ] Todos os testes **falham** (red) antes da Task 2; nenhum depende de rede/banco

**Dependencies:** none

---

### Task 2: Implementar detectores puros (DuplicateDetector, ChannelProfileCalculator) + leituras Conexos reaproveitadas das probes
**Files to change:**
- `src/backend/domain/service/sispag/DuplicateDetector.ts` (novo, puro, `@injectable()`)
- `src/backend/domain/service/sispag/ChannelProfileCalculator.ts` (novo, puro)
- `src/backend/domain/client/ConexosSispagClient.ts` (+ `listTitulosFavorecidoParaDuplicidade(filCod, pesCod, desde)` paginado, sem filtro `vldPago`)
- `src/backend/domain/client/ConexosSispagClient.test.ts`
- `src/backend/domain/client/ConexosExtratoClient.ts` / client de baixas fin010 (método read-only extraído da `probe-canal-por-fornecedor.ts`)
- `src/backend/domain/interface/sispag/SispagInterface.ts` (tipos `ItemAlertType`, `ChannelGroup`, `DuplicateCandidate`, `ChannelProfile`)
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`, `EnvironmentProvider.ts`, `EnvironmentProvider.test.ts`

**Acceptance criteria:**
- [ ] Testes da Task 1 passam
- [ ] Config do tenant via `EnvironmentProvider` com defaults: janela FRACA 15 dias, perfil ALTA 5 pagamentos / 3 meses / 0.95; valor inválido cai no default (testado)
- [ ] Leitura fin064 pagina de verdade (teste com 2 páginas mockadas, conferindo `count`), parseia com Zod, linha inválida é descartada sem derrubar a lista, vencimento ≥ 2026-01-01
- [ ] Leituras de fin010/fin095 são só `list` (nenhum método de escrita novo); a lógica de casamento vive no calculator, não no client
- [ ] Vocabulário de histórico do extrato em constante nomeada (heurística de implementação, não ontologia)
- [ ] `npm run typecheck` e `npm test` passam em `src/backend`

**Dependencies:** Task 1

---

### Task 3: Persistência — migrations 0076–0079 (alertas, bloqueio, pendência, perfil, conferência, permissões)
**Files to change:**
- `src/backend/migrations/0076_sispag_alerta_item_lote.sql` (`lote_pagamento_item_alerta` + coluna `verificacao_estado` em `lote_pagamento_item`)
- `src/backend/migrations/0077_sispag_bloqueio_pendencia.sql` (`titulo_bloqueio_duplicidade`, `pendencia_cadastro` + `pendencia_cadastro_origem`)
- `src/backend/migrations/0078_sispag_perfil_canal_conferencia.sql` (`perfil_canal_fornecedor`; em `lote_pagamento`: `conferido_por/em`, `devolvido_por/em`, `motivo_devolucao`; tabela de trilha só-inclusão `sispag_verificacao_evento`)
- `src/backend/migrations/0079_permissoes_sispag_conferir_cadastro.sql` (troca do CHECK como na 0068/0075, **sem** grants)
- testes `*.test.ts` correspondentes em `src/backend/migrations/`
- `src/backend/migrations/MigrationFiles.ts` (se a lista for explícita)
- `src/backend/domain/interface/auth/Permission.ts` (+ `SISPAG_CONFERIR: 'sispag:conferir'`, `SISPAG_CADASTRO: 'sispag:cadastro'`, avulsas)

**Acceptance criteria:**
- [ ] Migrations idempotentes (`IF NOT EXISTS`), numeração reconfirmada contra `origin/main`
- [ ] Unicidade: no máximo uma `pendencia_cadastro` `ABERTA` por `(pes_cod, tipo)` (índice parcial único); no máximo um `titulo_bloqueio_duplicidade` `ATIVO` por `(fil_cod, doc_cod, tit_cod)`; uma linha de perfil por `pes_cod`
- [ ] Tabela de trilha rejeita `UPDATE`/`DELETE` (trigger), padrão da `0075`
- [ ] Estados/tipos com `CHECK` batendo com as constantes TS (`ABERTA|RESOLVIDA|OBSOLETA|DESCARTADA`, `JUSTIFICADA|RETIRADA`, `ATIVO|ENCERRADO|DESFEITO`, `CONTA|CHAVE_PIX`, `BOLETO|TED_PIX|OUTROS`, `ALTA|MEDIA|BAIXA`, `PENDENTE|OK`)
- [ ] CHECK de permissões aceita as duas novas e todas as antigas; nenhum papel recebe concessão (Q8)
- [ ] Após `npm run build`, os quatro `.sql` estão em `dist/migrations/`
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** none (pode correr em paralelo às Tasks 1–2)

---

### Task 4: Repositories (alerta, bloqueio, pendência, perfil, trilha) + extensões em LotePagamentoRepository/TituloAPagarRepository
**Files to change:**
- `src/backend/domain/repository/sispag/AlertaItemLoteRepository.ts` + `.test.ts` (novos)
- `src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.ts` + `.test.ts` (novos)
- `src/backend/domain/repository/sispag/PendenciaCadastroRepository.ts` + `.test.ts` (novos)
- `src/backend/domain/repository/sispag/PerfilCanalFornecedorRepository.ts` + `.test.ts` (novos)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` + `.test.ts` (verificacaoEstado, conferência/devolução com `versao`, remoção pelo sistema)
- `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` + `.test.ts` (filtro de bloqueio ATIVO na listagem de elegíveis)

**Acceptance criteria:**
- [ ] Todo SQL só com `$1..$n` (assert na query mockada); todas as classes `@injectable()`
- [ ] Toda mutação de alerta/bloqueio/pendência/conferência grava o evento correspondente na trilha **na mesma transação** (I13m), com ator e instante
- [ ] `PendenciaCadastroRepository.abrirOuAcrescentar` reaproveita a `ABERTA` existente e só acrescenta o título de origem (I13k)
- [ ] `PerfilCanalFornecedorRepository.upsertRodada` grava em transação; rodada que falha não apaga perfil anterior
- [ ] `conferir`/`devolver` só atualizam com `status = 'FINALIZADO'` e `versao` batendo (zero linhas → conflito)
- [ ] Bloqueio `ATIVO` encerrado em lote para títulos que a ingestão marcou `ativo = false` (método dedicado)
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Task 3

---

### Task 5: VerificacaoTedPixService — orquestra duplicidade, canal e dados de pagamento (I13a–e, h–k)
**Files to change:**
- `src/backend/domain/service/sispag/VerificacaoTedPixService.ts` + `.test.ts` (novo)
- `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts` (reuso; só expor o que faltar, sem mudar I10)
- `src/backend/domain/errors/{PaymentCheckPendingError,PendingDuplicateAlertError,ItemsRemovedByCheckError}.ts` (novos)
- `src/backend/domain/recebimentosContainer.ts` / `appContainer.ts` (registro, se necessário)

**Acceptance criteria:**
- [ ] `verificarItens(loteId, itens?)` ignora itens não TED/PIX; item verificado com sucesso → `verificacaoEstado = OK`
- [ ] Falha de fin064/cmn025 → item `PENDENTE`, nenhuma alerta criada/obsoleta/descartada, nenhuma retirada, nenhuma pendência (teste por fonte que falha)
- [ ] Re-verificação: mesma contraparte+tipo mantém resolução (I13h); contraparte nova → alerta nova `ABERTA`; contraparte que sumiu → `OBSOLETA`; justificativa não migra de lote (Q7)
- [ ] Canal: perfil ALTA com grupo dominante ≠ `TED_PIX` → alerta `CANAL_HABITUAL` `ABERTA`; sem perfil ou não-ALTA → nada; perfil que deixou de divergir → `OBSOLETA`
- [ ] Dados de pagamento via `DestinoPagamentoResolver`: sem cadastro e sem exceção APROVADA → item removido (ator `sistema`, motivo `SEM_DADO_PAGAMENTO`, auditado) + `PendenciaCadastro` (`CONTA` p/ TED, `CHAVE_PIX` p/ PIX); com exceção APROVADA → item fica + pendência; cadastro com dado → nada, e pendência ABERTA do par é resolvida (I13k)
- [ ] Retirada pelo sistema não altera `automatico` do título (Q11)
- [ ] Logs em português, sem conta/chave em claro (teste espiona o `LogService`)
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Tasks 2, 4

---

### Task 6: Integração no ciclo do lote — modalidade, finalizar (L3), reabrir (L4), resolver alerta, bloqueio na formação/inclusão
**Files to change:**
- `src/backend/domain/service/sispag/LotePagamentoService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/FormacaoLotesService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/IngestaoPagamentosService.ts` + `.test.ts` (encerra bloqueio de título inativo)
- `src/backend/domain/service/sispag/DuplicateResolutionService.ts` + `.test.ts` (novo: `resolverAlertaDuplicidade` JUSTIFICAR/RETIRAR, `desfazerBloqueio`)
- `src/backend/domain/errors/DuplicateHoldError.ts` (novo)

**Acceptance criteria:**
- [ ] `atualizarModalidadeItem` → TED/PIX dispara verificação só daquele item; → BOLETO/"a definir" descarta alertas abertas do item (`DESCARTADA`, evento na trilha) (I13a)
- [ ] `finalizarLote` re-roda a verificação para todos os itens TED/PIX e barra, nesta ordem documentada no teste: item retirado nesta rodada → `ItemsRemovedByCheckError` (lote fica `RASCUNHO`, retirada gravada, Q5); item `PENDENTE` → `PaymentCheckPendingError`; alerta de duplicidade `ABERTA` → `PendingDuplicateAlertError` com lista por item. Alerta `CANAL_HABITUAL` não barra
- [ ] `resolverAlertaDuplicidade` só em `RASCUNHO`; JUSTIFICAR exige texto não vazio; RETIRAR remove o item e cria `BloqueioDuplicidade` `ATIVO`; ator = usuário autenticado
- [ ] Título com bloqueio `ATIVO` fica fora de `formarLotesAutomaticos` e `incluirTituloNoLote` lança `DuplicateHoldError` (I13g)
- [ ] Ingestão encerra bloqueio de título que ficou `ativo = false`; `desfazerBloqueio` exige motivo e é auditado
- [ ] Testes existentes do `LotePagamentoService`/`FormacaoLotesService` continuam verdes
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Task 5

---

### Task 7: Conferência por segunda pessoa — L12 conferir, L13 devolver, guard L8 no gerarRemessa, L4 limpa
**Files to change:**
- `src/backend/domain/service/sispag/ConferenciaLoteService.ts` + `.test.ts` (novo; padrão de 2ª pessoa do `ExcecaoDestinoService`)
- `src/backend/domain/service/sispag/LotePagamentoService.ts` + `.test.ts` (`reabrirLote` limpa conferência; `exigeConferencia` derivado)
- `src/backend/domain/service/sispag/RemessaService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoApiView.ts` (expor `exigeConferencia`, `conferidoPor/Em`, `devolvidoPor/Em`, `motivoDevolucao`)
- `src/backend/domain/errors/{ConferenceRequiredError,SelfConferenceError}.ts` (novos)

**Acceptance criteria:**
- [ ] `exigeConferencia` = lote tem ≥1 item TED ou PIX; lote só boleto não exige
- [ ] `conferirLote`: só `FINALIZADO`, `exigeConferencia` e ainda não conferido; `SelfConferenceError` se o ator for `finalizadoPor`, `incluidoPor` de qualquer item ou `criadoPor` de lote manual (comparação pelo username canônico); grava `conferidoPor/Em`, incrementa `versao`, evento na trilha
- [ ] `devolverLote`: mesmas restrições de pessoa; motivo obrigatório; `FINALIZADO → RASCUNHO`; limpa conferência e finalização; grava `devolvidoPor/Em/motivoDevolucao`
- [ ] `reabrirLote` (L4) limpa conferência
- [ ] `gerarRemessa` em lote com `exigeConferencia` sem conferência → `ConferenceRequiredError` **antes** de qualquer chamada ao ERP; não re-verifica itens no L8 (Q10)
- [ ] Testes existentes de `RemessaService` seguem verdes
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Task 4 (paralelizável com Tasks 5–6)

---

### Task 8: Fila de PendenciaCadastro (list + auto-resolve na leitura)
**Files to change:**
- `src/backend/domain/service/sispag/PendenciaCadastroService.ts` + `.test.ts` (novo)

**Acceptance criteria:**
- [ ] `listarAbertas()` reconfere no cmn025 cada pendência `ABERTA` e marca `RESOLVIDA` (ator `sistema`, evento na trilha) as que passaram a ter o dado; retorna só as ainda abertas, com favorecido, tipo e títulos de origem
- [ ] Falha de leitura do cmn025 de uma pendência não a resolve e não derruba a lista (falha fechada)
- [ ] Não existe transição manual `ABERTA → RESOLVIDA` (nenhum método público para isso)
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Tasks 4, 5

---

### Task 9: Rotas HTTP + permissões (sispag.ts)
**Files to change:**
- `src/backend/routes/sispag.ts` + teste de rota correspondente
- `src/backend/http/acesso.ts` (se precisar mapear as permissões novas)
- mapeamento erro → HTTP (onde os erros SISPAG já são traduzidos)

**Acceptance criteria:**
- [ ] `POST /sispag/lotes/:id/itens/:chave/alertas/:alertaId/resolucao` (JUSTIFICAR|RETIRAR, Zod) com `sispag:executar`
- [ ] `POST /sispag/titulos/:chave/bloqueio-duplicidade/desfazer` (motivo, Zod) com `sispag:executar`
- [ ] `POST /sispag/lotes/:id/conferir` e `POST /sispag/lotes/:id/devolver` (motivo) com `sispag:conferir`
- [ ] `GET /sispag/pendencias-cadastro` com `sispag:cadastro`
- [ ] `GET` do lote passa a trazer alertas por item (com justificativa), `verificacaoEstado`, origem do destino e dados de conferência; conta/chave mascaradas
- [ ] Ator sempre de `req.user.sub` (teste: body com outro ator é ignorado)
- [ ] 409 para `PaymentCheckPendingError`, `PendingDuplicateAlertError`, `ItemsRemovedByCheckError`, `DuplicateHoldError`, `ConferenceRequiredError`; 403 para `SelfConferenceError` e falta de permissão
- [ ] `npm run typecheck`, `npm run lint` e `npm test` passam

**Dependencies:** Tasks 6, 7, 8

---

### Task 10: Job read-only do perfil de canal + workflow semanal (calcularPerfilCanal)
**Files to change:**
- `src/backend/domain/service/sispag/PerfilCanalService.ts` + `.test.ts` (novo: lê fin010 × fin095, calcula via `ChannelProfileCalculator`, grava via repository)
- `src/backend/jobs/calcular-perfil-canal.ts` (novo, `import 'reflect-metadata'`)
- `.github/workflows/calcular-perfil-canal.yml` (novo, cron semanal + `workflow_dispatch`, minuto sem colisão com os crons existentes)
- `package.json` de `src/backend` (script `job:perfil-canal`, se for o padrão dos outros jobs)

**Acceptance criteria:**
- [ ] Job só faz leituras no Conexos (nenhum método de escrita é chamado; teste com client mockado espiona)
- [ ] Não depende de efeito de boot novo no `bootstrapAppContainer` (gotcha: compartilhado com ~58 jobs)
- [ ] Rodada que falha não apaga perfis anteriores; grava `calculadoEm`/`jobRunId`/janela
- [ ] Log de início/fim/contagens em português (fornecedores lidos, perfis ALTA/MEDIA/BAIXA, casamentos ambíguos descartados)
- [ ] Workflow usa os mesmos secrets dos outros crons Conexos e falha visivelmente (exit code ≠ 0) em erro; run com 0 perfis não é tratado como sucesso silencioso (log explícito)
- [ ] `npm run typecheck` e `npm test` passam

**Dependencies:** Tasks 2, 4

---

### Task 11: ObservabilityAdvisor review (job `calcular-perfil-canal` + verificação)
**Files to change:**
- nenhum obrigatório; ajustes que o advisor pedir em `VerificacaoTedPixService.ts`, `PerfilCanalService.ts`, `jobs/calcular-perfil-canal.ts`
- (se o advisor recomendar) registro do pipeline no detector de staleness (`ontology/business-rules/staleness-por-pipeline.md` + config do `detect-staleness`)

**Acceptance criteria:**
- [ ] ObservabilityAdvisor chamado para o job novo `calcular-perfil-canal` e para os eventos de verificação
- [ ] Mensagens de `LogService` em português, com `data` estruturado (loteId, filCod, docCod, tipo de alerta, contagens), sem conta/chave em claro
- [ ] Recomendações P0 do advisor aplicadas; as demais registradas como follow-up no inbox

**Dependencies:** Tasks 5, 10

---

### Task 12: Frontend — alertas nos itens, diálogos de justificar/retirar, conferência, pendências de cadastro, TED/PIX livres
**Files to change:**
- `src/frontend/lib/sispag.ts` + `sispag.test.ts` (tipos e chamadas novas)
- `src/frontend/lib/permissoes.ts` + `permissoes.test.ts` (`sispag:conferir`, `sispag:cadastro`)
- `src/frontend/app/sispag/components/LoteCard.tsx` + `LoteCard.test.tsx` (badges de alerta por item, `verificacaoEstado` pendente, estado "aguardando conferência", botões conferir/devolver, oferta TED/PIX livre com a flag ligada — I10b revisado)
- `src/frontend/app/sispag/components/ResolverDuplicidadeDialog.tsx` + `.test.tsx` (novo: justificar com texto obrigatório / retirar com aviso "cancelar no Conexos")
- `src/frontend/app/sispag/components/ConferenciaLoteDialog.tsx` + `.test.tsx` (novo: visão do conferente — favorecido, conta/chave mascarada, origem CADASTRO/EXCECAO, valor, alertas com justificativa, canal; devolver com motivo)
- `src/frontend/app/sispag/pendencias-cadastro/page.tsx` + `page.test.tsx` (nova; padrão `excecoes/`, gated por `sispag:cadastro` via `ExigePermissao`)
- `src/frontend/components/nav/app-nav.tsx` (entrada da página nova, gated)

**Acceptance criteria:**
- [ ] Mensagens dos 409/403 novos aparecem em português na tela (finalizar barrado lista os itens com alerta)
- [ ] Botões conferir/devolver só aparecem com `sispag:conferir` e nunca para quem finalizou (o backend continua sendo a autoridade)
- [ ] Página de pendências só acessível com `sispag:cadastro`; sem a permissão, nav não mostra e rota nega
- [ ] Analista nunca digita conta/chave no lote (nenhum campo novo de destino)
- [ ] `cd src/frontend && npm run typecheck && npm run lint && npm test` passam
- [ ] DesignSystemReviewer gate aprovado

**Dependencies:** Task 9

---

### Task 13: Ground-truth — script read-only de validação contra PRD (duplicidade e canal)
**Files to change:**
- `src/backend/jobs/validate-sispag-verificacoes-ted-pix-v1.ts` (novo)

**Acceptance criteria:**
- [ ] Só leituras (fin064, fin010, fin095, cmn025); não usa `bootstrapAppContainer`; saída local; rodado com `databaseConnectionString=""`
- [ ] Duplicidade: roda o `DuplicateDetector` sobre o fin064 PRD de todas as filiais e (a) reencontra o caso canônico fil 4 docs 6173 × 6702 como FORTE, (b) bate 100% com o conjunto de pares FORTE da `probe-duplicidade-titulos.ts` na mesma janela (divergência = P0)
- [ ] Canal: roda `ChannelProfileCalculator` e compara com a saída da `probe-canal-por-fornecedor.ts` (participação de valor em fornecedores ALTA ≈ 89%, tolerância ±2 p.p.; contagem de fornecedores ALTA idêntica para os mesmos limiares)
- [ ] Relatório (contagens, amostra de pares, tolerâncias, veredito) colado no PR
- [ ] Plano revisado pelo GroundTruthValidator antes da execução

**Dependencies:** Tasks 2, 10

---

### Task 14: Release — bump de versão à mão + CHANGELOG + passos de rollout
**Files to change:**
- `src/backend/package.json`, `src/frontend/package.json` (lockstep, bump **minor** — delta tem `feat`)
- `CHANGELOG.md`

**Acceptance criteria:**
- [ ] Versão real da `main` conferida antes de bumpar (sessões paralelas colidem); FE == BE
- [ ] `scripts/bump-version.ps1` **não** é usado (sem pwsh no Linux): regra de semver aplicada à mão nos dois `package.json`, commit `chore(release): vX.Y.Z`
- [ ] CHANGELOG descreve: verificações TED/PIX, bloqueio por duplicidade, conferência por 2ª pessoa, fila de pendências, job de perfil
- [ ] PR lista passos de rollout: conceder `sispag:conferir`/`sispag:cadastro` pela tela de usuários (Q8), rodar o workflow `calcular-perfil-canal` uma vez manualmente antes de ligar (schedules só disparam da `main`), conferir migrations 0076–0079 aplicadas em produção

**Dependencies:** Tasks 1–13

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (src/backend e src/frontend)
- [ ] `npm run lint` ✅ (src/backend e src/frontend)
- [ ] `npm test` ✅ (src/backend e src/frontend)
- [ ] PatternGuardian gate ✅
- [ ] ontology diff em `ontology/` presente (ADR-0063, commit 094e312) ✅ — `implementation_status`/`has_canonical_test` de `verificacao-ted-pix-sispag.md` e `_index.json`/`_coverage.json` atualizados ao final
- [ ] DesignSystemReviewer gate ✅ (frontend tocado)
- [ ] ObservabilityAdvisor review ✅ (job novo `calcular-perfil-canal`)
- [ ] Ground-truth validation (Task 13) ✅ sem divergência acima da tolerância
- [ ] Regis-Review gate ✅ (P0 remediados; P1–P3 no inbox)
- [ ] Rebase de `main` sem conflitos pendentes, gates ainda verdes ✅
- [ ] app version bumped (FE+BE lockstep) **à mão** (sem pwsh nesta máquina) + `CHANGELOG.md` updated ✅
