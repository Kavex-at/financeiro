# Tasks: sispag-ted-pix

**Spec source:** ontology/_inbox/sispag-ted-pix-interview.md (+ ontology/_inbox/sispag-ted-pix-plan.md, ADR-0054 com Adendo de 2026-09-28)
**Ontology diff:** yes — `ontology/decisions/0054-destino-de-pagamento-sispag-digitado-no-item.md`, `ontology/business-rules/destino-pagamento-sispag.md` (I10a–i), `ontology/entities/lote-pagamento.md`, `ontology/state-machines/lote-pagamento.md`, `ontology/actions/sispag/finalizar-lote.md` (commit fb9bdc6)
**Estimated scope:** L (backend: 1 migration, 1 client read, 1 resolver novo, 3 services, validator, rotas; frontend: 1 dialog + LoteCard + lib; 1 probe script)

> **Regras transversais (valem para toda task):**
> - Sem HML. Tudo o que não foi provado fica atrás de flag **desligada por padrão**, lida só via
>   `EnvironmentProvider`: `SISPAG_TED_ENABLED`, `SISPAG_DESTINO_MANUAL_ENABLED`, `SISPAG_PIX_ENABLED`.
>   Com as três desligadas, o comportamento é **idêntico ao `main`** (crédito em conta já fora da oferta, `fc22dcd`).
> - `validacao/modalidadeTed` e `validacao/modalidadePix` **não são chamados** (H1 não provado).
> - Nada escreve no `cmn025`. Sem quatro olhos. Sem bump de versão (é no Ship).
> - Conta/chave **nunca** em claro em log, `LogService.data`, mensagem de erro ou `remessa_execucao.requestPayload`.
> - Identificadores em inglês; mensagens ao operador e logs em português. Classes exportadas, métodos arrow,
>   modificadores explícitos, Zod nas bordas, SQL parametrizado, `@injectable()`/`@singleton()`.
> - Migration: próximo número livre hoje é **0066** (conferido no worktree e em `origin/main`, último = `0065`).
>   Reconfirmar contra `origin/main` antes do commit (sessões paralelas colidem). O `npm run build` já copia
>   `migrations/*.sql` (gotcha do CLAUDE.md) — conferir que o arquivo novo aparece em `dist/`.

## Task list

### Task 1: Flags e leituras do cadastro (EnvironmentProvider + ConexosSispagClient)
**Files to change:**
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/client/ConexosSispagClient.ts`
- `src/backend/domain/client/ConexosSispagClient.test.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts`

**Tests to write first (TDD):**
- `EnvironmentProvider.test.ts`: sem env → `sispagTedEnabled`, `sispagDestinoManualEnabled`, `sispagPixEnabled` são `false`; `'true'` liga; qualquer outro valor (`'1'`, `'yes'`, vazio) fica `false`.
- `ConexosSispagClient.test.ts`: `listChavesPixFavorecido(pesCod, filCod)` chama `cmn025/cmnPessoasPix/list` com filtro `pesCod#EQ` e header `Cnx-filCod`; parseia com Zod `cixCod, cixDesChave, cixVldTipo, cixVldSituacao, cixVldDefault, pesCod`; filtra `cixVldSituacao === 1`; ordena default primeiro; linha com schema inválido é descartada sem derrubar a lista.
- `ConexosSispagClient.test.ts`: `getDocumentoFavorecido(pesCod, filCod)` devolve CPF/CNPJ só-dígitos ou `undefined`, validado por Zod. O **nome do campo** é hipótese (constante nomeada `CAMPO_DOCUMENTO_FAVORECIDO` com comentário "a confirmar no teste supervisionado"); resposta sem o campo → `undefined`, nunca throw.
- `ConexosSispagClient.test.ts`: `listContasFavorecido` não filtra mais por banco dentro do client (o filtro, se houver, é do resolver) — teste de regressão de que contas de qualquer banco voltam.

**Acceptance criteria:**
- [ ] Três flags novas em `EnvironmentVars`, default `false`, sem `process.env` fora do provider
- [ ] Mapeamento de `cixVldTipo` em constante tipada (`1 TELEFONE, 2 EMAIL, 3 CPF_CNPJ, 4 ALEATORIA`), nunca número cru espalhado
- [ ] Nenhum `LogService` dessas leituras loga `cixDesChave` ou documento em claro (teste espiona o logger)
- [ ] Nenhuma chamada a `validacao/modalidade*` existe no client (grep no teste ou no gate)
- [ ] `npm run typecheck` e `npm test` passam em `src/backend`

**Dependencies:** none

---

### Task 2: Persistência do destino manual e da trilha (migration 0066 + repository)
**Files to change:**
- `src/backend/migrations/0066_sispag_destino_manual.sql`
- `src/backend/migrations/0066_sispag_destino_manual.test.ts`
- `src/backend/migrations/MigrationFiles.ts` (se a lista for explícita)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts`

**Tests to write first (TDD):**
- `0066_*.test.ts`: migration idempotente (`IF NOT EXISTS`); cria em `lote_pagamento_item` a coluna `destino_manual jsonb NULL`; cria `lote_pagamento_item_destino_audit` só-inclusão (`id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, alterado_em, antes jsonb, depois jsonb`) com trigger/regra que rejeita `UPDATE`/`DELETE`.
- `LotePagamentoRepository.test.ts`: `setDestinoManualItem({loteId, chave, versao, destino, usuario})` é **uma transação** que (a) atualiza o item só se `lote.status = 'RASCUNHO'` e `versao` bate (incrementa `versao`), (b) insere a linha de auditoria com antes/depois; versão errada → zero linhas e nenhuma auditoria; SQL só com `$1..$n` (assert na query mockada).
- `LotePagamentoRepository.test.ts`: `getLoteComItens` devolve `destinoManual` parseado por Zod (discriminated union `CONTA | CHAVE_PIX`); JSON inválido no banco → item sem destino + log de aviso sem conteúdo.

**Acceptance criteria:**
- [ ] Tipo `DestinoManual` no `SispagInterface.ts`: `CONTA {bancoCod, agencia, agenciaDv?, conta, contaDv, titularDocumento}` e `CHAVE_PIX {chavePixTipo, chavePix, titularDocumento}`
- [ ] Auditoria só-inclusão provada por teste (UPDATE/DELETE falham)
- [ ] A auditoria guarda o valor completo (é a trilha I10g) e nenhum log ecoa o JSON
- [ ] Arquivo `.sql` aparece em `dist/migrations/` depois de `npm run build`
- [ ] Número `0066` reconfirmado contra `origin/main` antes do commit

**Dependencies:** none

---

### Task 3: Resolver único de destino e validação de formato/titularidade (I10a–d, I10i)
**Files to change:**
- `src/backend/domain/service/sispag/DestinoPagamentoResolver.ts` (novo, `@injectable()`)
- `src/backend/domain/service/sispag/DestinoPagamentoResolver.test.ts`
- `src/backend/domain/libs/sispag/DestinoManualValidator.ts` (novo; classe com métodos arrow)
- `src/backend/domain/libs/sispag/DestinoManualValidator.test.ts`
- `src/backend/domain/libs/sispag/MaskDestino.ts` (novo; máscara reutilizada por log, API e tela)
- `src/backend/domain/libs/sispag/MaskDestino.test.ts`

**Tests to write first (TDD):**
- Casos canônicos 1, 2, 3 do interview: flag TED ligada, lote Itaú 341, favorecido só com conta 237 → resolve `{origem: 'CADASTRO', pctCodSeq}`; duas contas ativas → a `pctVldDefault`; só conta inativa → `nenhum`.
- Flag TED **desligada**: resolver reproduz a regra do `main` (só conta no banco do lote), para o item continuar saindo como hoje.
- Precedência: `destinoManual` existe (e flag manual ligada) → `{origem: 'MANUAL'}` mesmo com conta no cadastro. Flag manual desligada → destino manual persistido é **ignorado** (não é oferta nem envio).
- PIX (flag ligada): chave ativa default primeiro → `{origem: 'CADASTRO', chave}`; sem chave e sem manual → `nenhum` (caso 6). Flag PIX desligada → PIX nunca resolve.
- `DestinoManualValidator`: FEBRABAN 3 dígitos; agência/conta/DV só dígitos; CPF e CNPJ com DV válido; e-mail; telefone `+55` + DDD; aleatória = UUID; tipo **não inferido** (11 dígitos com tipo `TELEFONE` valida como telefone).
- Titularidade (I10i): `titularDocumento` ≠ documento do favorecido → erro `DestinoTitularDivergenteError` com mensagem PT; chave `CPF_CNPJ` ≠ documento → mesmo erro; documento do favorecido indisponível → `DocumentoFavorecidoIndisponivelError` (fail closed) com mensagem PT clara.
- `MaskDestino`: conta `****5678-9`, CPF `***.456.789-**`, e-mail `j***@dominio.com`, aleatória só os 4 últimos; nunca devolve o valor completo.

**Acceptance criteria:**
- [ ] **Uma** função pública `resolve(item, contexto)` usada por oferta (Task 5) e envio (Task 4) — I10b
- [ ] Constantes nomeadas para origens e tipos de chave; nenhuma string crua de status
- [ ] Mensagens de erro em PT e sem conta/chave em claro (asserção nos testes)
- [ ] Classes exportadas, sem funções soltas; Zod na entrada do validator
- [ ] `npm test` e `npm run typecheck` passam

**Dependencies:** Task 1, Task 2

---

### Task 4: Envio — TED→5, qualquer banco, PIX e destino manual no payload do fin015 (I10a, c, d, f, h)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (`MODALIDADE_NATIVA` ~l.41; `montarItensImport` ~l.900–1040; guarda de mesmo banco ~l.982)
- `src/backend/domain/service/sispag/RemessaService.test.ts`
- `src/backend/domain/client/Fin015Write.ts` (tipos do payload do item)
- `src/backend/domain/errors/` (novo `DestinoPagamentoAusenteError`, irmão de `BoletoSemCodigoBarrasError`)

**Tests to write first (TDD):**
- Regressão do bug: flag TED ligada → item TED sai com `itsVldModalidade = 5` e `pctCodSeq` da conta de outro banco (caso 1). Flag desligada → sai `1` e a guarda de mesmo banco continua (igual ao `main`).
- PIX (flag ligada): payload com `itsVldChavePix = 1` e `itsDesChavePix`; `itsVldModalidade` vem de **uma** constante `MODALIDADE_PIX_NATIVA` com comentário "H4 — valor a confirmar no teste supervisionado" (caso 5).
- TED manual (caso 4): item **sem** `pctCodSeq`, com banco/agência/conta/DV digitados nos campos do item.
- Item TED/PIX sem destino (caso 6 forçado via API): `DestinoPagamentoAusenteError` nomeando o item, lançado **antes do `criarLote`** (assert: `criarLote` nunca chamado).
- Documento do favorecido indisponível com destino manual → falha fechada antes de qualquer escrita.
- Congelamento/retomada (caso 7): o destino entra na assinatura da marca d'água do lote órfão (como `dataDebito`, I8b); retry reenvia o destino persistido, não relê o cadastro.
- Ledger: `requestPayload` gravado em `remessa_execucao` **não contém** conta, chave nem documento (asserção de string sobre o JSON serializado); logs do envio idem.
- Lote misto boleto + TED + PIX (caso 9): cada item com sua modalidade; boleto DDA inalterado.

**Acceptance criteria:**
- [ ] `montarItensImport` chama o `DestinoPagamentoResolver` da Task 3 (nenhuma regra de destino duplicada)
- [ ] Nenhuma chamada a `validacao/modalidadeTed|Pix`
- [ ] Com as três flags desligadas, o snapshot de payload do teste existente de TED/boleto não muda
- [ ] Nenhum dado sensível em `requestPayload`, `LogService.data` ou mensagem de erro (teste)
- [ ] `npm test`, `npm run typecheck`, `npm run lint` passam

**Dependencies:** Task 3

---

### Task 5: Oferta, edição do destino e finalizar leve (painel, LotePagamentoService, rotas, flags na API)
**Files to change:**
- `src/backend/domain/service/sispag/SispagPainelService.ts` (`modalidadesDisponiveisDoLote`)
- `src/backend/domain/service/sispag/SispagPainelService.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoService.ts` (`definirDestinoManualItem`, `limparDestinoManualItem`, `finalizarLote`)
- `src/backend/domain/service/sispag/LotePagamentoService.test.ts`
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.test.ts` (ou o teste de rota existente)

**Tests to write first (TDD):**
- Oferta = envio (caso 3): para o mesmo fixture, `modalidadesDisponiveisDoLote` oferece TED/PIX **se e só se** o resolver da Task 3 resolve (teste parametrizado que chama os dois).
- Oferta devolve por item `{origem, destinoMascarado}`; nunca o valor completo.
- `definirDestinoManualItem`: flag manual desligada → 403/erro de domínio; lote fora de RASCUNHO → recusa (I10e); `versao` errada → conflito (409, igual às edições atuais); titularidade divergente → 422 com mensagem PT; sucesso grava trilha (usuário do request) e devolve lote com destino mascarado.
- Congelamento (I10f/caso 7): item cujo destino já foi importado no `fin015` (ledger com import concluído para o lote nativo ainda existente) → recusa com mensagem PT, mesmo que o lote tenha sido reaberto.
- `finalizarLote` checagem LEVE: item TED/PIX sem destino manual **e** sem opção ofertada → recusa com mensagem PT nomeando o item; com opção ofertada ou manual → passa. Nenhuma leitura estrita extra aqui.
- Rotas: `POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/destino` e `DELETE` do mesmo caminho, `requireRole('admin')`, body Zod (`versao` + union do destino); `GET /sispag/recursos` devolve `{tedEnabled, destinoManualEnabled, pixEnabled}`.

**Acceptance criteria:**
- [ ] Oferta e envio usam a mesma instância do resolver (teste de paridade verde)
- [ ] Respostas da API nunca trazem conta/chave/documento completos
- [ ] Erros de validação da rota em 400 com `details` do Zod, sem ecoar o valor enviado
- [ ] Flags expostas ao frontend só como booleanos
- [ ] `npm test`, `npm run typecheck`, `npm run lint` passam

**Dependencies:** Task 3, Task 4 (para a paridade e o congelamento)

---

### Task 6: RemessaCnabValidator — segmento B e forma de lançamento (só aviso)
**Files to change:**
- `src/backend/domain/libs/cnab/RemessaCnabValidator.ts`
- `src/backend/domain/libs/cnab/RemessaCnabValidator.test.ts`

**Tests to write first (TDD):**
- Conta segmentos B por lote e reporta, para cada segmento A, a forma de lançamento lida do header de lote (posições 12–13).
- Códigos hipotéticos (41/43/45) aparecem como **aviso** no relatório, nunca como throw; fixture atual de boleto/crédito continua passando igual.
- Caso 8 (PIX saindo como crédito em conta) fica registrado como aviso nomeado `FORMA_DIVERGENTE_A_CONFIRMAR`; o `RemessaCorrompidaError` para esse caso só é ligado depois do teste supervisionado (comentário no código apontando para esta checklist).
- Segmento A de TED/PIX sem B → aviso.

**Acceptance criteria:**
- [ ] Nenhum hard-fail novo; validações existentes inalteradas
- [ ] Relatório do validador sem dados de conta/chave (só códigos e contagens)
- [ ] `npm test` passa

**Dependencies:** none

---

### Task 7: Frontend — dialog "Informar destino", badge manual, oferta e bloqueio do finalizar
**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/lib/sispag.test.ts`
- `src/frontend/app/sispag/components/InformarDestinoDialog.tsx` (novo)
- `src/frontend/app/sispag/components/InformarDestinoDialog.test.tsx` (novo)
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/components/LoteCard.test.tsx`

**Tests to write first (TDD):**
- `lib/sispag`: `getRecursos()`, `definirDestinoItem()`, `limparDestinoItem()` com `versao`; 409 vira mensagem de conflito como nas edições atuais.
- `LoteCard`: flags desligadas → nenhum TED/PIX/botão de destino renderizado (igual ao `main`); flag manual ligada e lote RASCUNHO → botão "Informar destino" ao lado da modalidade; fora de RASCUNHO → destino só leitura; destino manual aparece **mascarado** com badge "manual"; item sem destino → finalizar desabilitado com a mensagem do backend.
- `InformarDestinoDialog`: abas TED (banco, agência, DV, conta, DV, CPF/CNPJ do titular) e PIX (tipo escolhido pela analista + chave + CPF/CNPJ do titular, PIX só se a flag PIX estiver ligada); validação de formato no cliente espelha o backend; erro de titularidade do backend exibido; valor completo nunca é logado no console.

**Acceptance criteria:**
- [ ] Com as três flags desligadas, snapshot/teste do LoteCard igual ao `main`
- [ ] Máscara idêntica à do backend (o frontend exibe o `destinoMascarado` recebido; não re-mascara dado completo)
- [ ] Tokens e componentes do design system do repo (`src/frontend/docs/`)
- [ ] `npm test`, `npm run typecheck`, `npm run lint` passam em `src/frontend`
- [ ] DesignSystemReviewer gate

**Dependencies:** Task 5

---

### Task 8: Sonda read-only para o teste supervisionado (H6/H7 + documento do favorecido)
**Files to change:**
- `src/backend/jobs/probe-sispag-ted-pix-supervisionado.ts` (novo; **não executado neste ciclo**)

**Tests to write first (TDD):**
- Não há teste unitário de sonda (padrão dos `probe-*.ts`); o script usa só métodos `get`/`list` do client, sem nenhum verbo de escrita (checado por grep no gate).

**Acceptance criteria:**
- [ ] Argumentos `--fil <filCod> --flp <flpCod> --pes <pesCod>`; lê o item importado no `fin015` e imprime `itsVldModalidade`, `fbtCod`, `fbtDesDescr`, `fbtEspCodbanco`, presença de `pctCodSeq`, `itsVldChavePix` (H6/H7)
- [ ] Lê o cadastro da pessoa e lista os **nomes** dos campos que parecem CPF/CNPJ, com valor mascarado, para confirmar `CAMPO_DOCUMENTO_FAVORECIDO`
- [ ] Não imprime conta/chave em claro; não chama `validacao/*`
- [ ] Comentário no topo: usar credencial própria (incidente do plano §7) e `databaseConnectionString=""` (sessão do robô contaminável)
- [ ] `npm run typecheck` passa

**Dependencies:** Task 1

---

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (src/backend e src/frontend)
- [ ] `npm run lint` ✅ (src/backend e src/frontend)
- [ ] `npm test` ✅ (src/backend e src/frontend)
- [ ] PatternGuardian gate ✅
- [ ] [if entity_changed] ontology diff in `ontology/` present ✅ (fb9bdc6; atualizar `implementation_status` de `destino-pagamento-sispag.md` e `_index.json` ao fim)
- [ ] [if frontend touched] DesignSystemReviewer gate ✅
- [ ] [if new handler/job] ObservabilityAdvisor review ✅ — não se aplica: sem handler/job novo (a sonda é script manual); revisar só os logs novos no RemessaService sob I10h
- [ ] [if delta has feat/fix/perf in `src/`] app version bumped (FE+BE lockstep) via `scripts/bump-version.ps1` at Ship + `CHANGELOG.md` updated ✅ (sem pwsh nesta máquina: semver à mão nos dois package.json)
- [ ] Com as três flags desligadas, nenhuma diferença de comportamento em relação ao `main` (testes de regressão das Tasks 3, 4 e 7)

## Checklist do teste supervisionado em produção (roda com o usuário, após o merge e deploy com flags OFF)

Pré-requisitos: credencial Conexos própria no `.env` local; `databaseConnectionString=""` nas sondas; `SISPAG_LIVE_WRITE_ENABLED` só ligado durante a janela do teste.

1. **Deploy com as três flags OFF.** Conferir que a tela do SISPAG está igual à de antes (sem TED/PIX/destino).
2. **H1 (não chamar).** Confirmar nos logs da janela que nenhum `validacao/modalidade*` foi chamado.
3. **Primeiro TED, valor baixo, cadastro.** Ligar só `SISPAG_TED_ENABLED`. Montar lote com um título de valor baixo cujo favorecido tem conta ativa em banco diferente do lote. Finalizar, gerar remessa.
4. **H6.** Rodar `probe-sispag-ted-pix-supervisionado.ts` sobre o `flpCod`: `itsVldModalidade` gravado é 5? Se o ERP sobrescreveu, anotar o valor e ajustar `MODALIDADE_NATIVA`.
5. **H7.** Pela mesma sonda: `fbtCod`/`fbtDesDescr`/`fbtEspCodbanco` gravados. Anotar a finalidade que o ERP usou.
6. **Validador.** Ler o relatório do `RemessaCnabValidator` do `.REM`: forma de lançamento do segmento A e segmento B presente. Registrar o código real de TED (hipótese 41/43).
7. **Documento do favorecido.** A sonda lista os campos de documento do `cmn025`: confirmar `CAMPO_DOCUMENTO_FAVORECIDO`.
8. **H3 — TED manual.** Ligar `SISPAG_DESTINO_MANUAL_ENABLED`. Em outro título de valor baixo, digitar a conta (favorecido sem conta no cadastro). O `fin015` aceita item sem `pctCodSeq`? **Se recusar: parar e conversar com o usuário** antes de qualquer fallback (opção A, escrita no `cmn025`).
9. **Retorno do banco do TED.** Aguardar o retorno/conciliação (automáticos do banco) e confirmar o pagamento com a Columbia.
10. **H4 — primeiro PIX, valor baixo, cadastro** (só se houver favorecido com chave ativa no `cmnPessoasPix`). Ligar `SISPAG_PIX_ENABLED`. Sonda: `itsVldModalidade`, `itsVldChavePix`, campos exigidos; validador: forma de lançamento do PIX (hipótese 45). Ajustar `MODALIDADE_PIX_NATIVA`.
11. **H5 — PIX com chave digitada** fora do `cmnPessoasPix`, valor baixo. Se o `fin015` recusar: parar e conversar com o usuário.
12. **Depois de provado:** transformar os avisos do validador em `RemessaCorrompidaError` (caso 8) num `/feature-tweak` curto, e registrar os resultados de H3–H7 no ADR-0054.
