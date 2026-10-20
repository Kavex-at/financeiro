# Tasks: sispag-boleto-agrupado

**Spec source:** `ontology/_inbox/sispag-boleto-agrupado-interview.md` (respostas do maintainer P0-1..5, P1-1..5) + `ontology/_inbox/sispag-boleto-agrupado-ontology-diff.md` (aprovado em 2026-10-20, PI-1..PI-9 decididos) + `ontology/_inbox/sispag-boleto-agrupado-hml-achados.md` (H1–H10) + ontologia v0.47.0 (commit 0126920, `planned`)
**Ontology diff:** yes (já aplicado, `implementation_status: planned`) — `ontology/decisions/0076-sispag-boleto-agrupado-bordero.md`, `ontology/business-rules/boleto-agrupado-sispag.md` (I19a–u), `ontology/entities/grupo-boleto.md`, ações `ontology/actions/sispag/{sugerir-grupos-boleto,confirmar-grupo-boleto,anular-grupo-boleto,preparar-bordero-do-grupo,limpar-bordero-do-grupo}.md`, emendas em `business-rules/{elegibilidade-titulo-lote (I2),nao-duplicacao-titulo-lote (I3),lote-uma-filial (I4),sincronizacao-status-lote-sispag (I11i),sugestao-boleto-dda-sispag (I15e(4)/I15m/I15q),boleto-exige-codigo-de-barras (I16a/d/d.1/e/h),vinculo-codbar-item-sispag (I17o),retomada-remessa-sispag (preparar_bordero)}.md`, `state-machines/lote-pagamento.md` (L2/L3/L5/L6/L8/L11), `entities/{lote-pagamento (grupoBoletoId),bloqueio-duplicidade (GRUPO_BOLETO),alerta (sispag-bordero-grupo-pendente),decisao-sugestao-boleto,boleto-dda}.md`, `actions/sispag/{finalizar-lote,formar-lotes-automaticos,gerenciar-lote-candidato,vincular-codigo-barras-ao-item}.md`, `integrations/conexos.md` (seção "ESCRITA SISPAG — borderô do boleto agrupado")
**entity_changed:** true (entidade nova `GrupoBoleto` + `GrupoBoletoTitulo`; `ItemLote.grupoBoletoId`; ledger novo de execução do borderô por grupo, padrão I-2; origem nova de `BloqueioDuplicidade`; tipo novo de `Alerta`)
**Estimated scope:** XL (backend ~22 arquivos novos/alterados + 1 migration + ~6 rotas; frontend ~9 arquivos; 3 jobs de verificação: medição HML durante o TDD, prova HML ponta a ponta com o serviço de produção, medição PRD só leitura)
**Mode:** `/feature-tweak`. Serviços novos `GrupoBoletoService` (sugerir/confirmar/anular) e `BorderoGrupoBoletoService` (preparar/limpar o borderô); estende `RemessaService`, `VinculoCodigoBarrasService`, `RetiradaCodigoBarrasService`, `LotePagamentoService`, `FormacaoLotesService`, `BoletoSuggestionService`/`MotorSugestaoBoleto`, `ConciliacaoRetornoService`, `SincronizacaoLoteService`/`DecisaoStatusLote`, `ConexosBaixaClient`, `ConexosSispagWriteClient`.
**Entrega:** **sem flag e sem modos** (P0-5). O código fica ativo no merge, sob o kill-switch existente `sispagLiveWriteEnabled` e o dry-run do Conexos (`conexosWriteEnabled`/`conexosDryRun`). O merge **é** o rollout em PRD: por isso a prova HML ponta a ponta (Task 21) e a medição PRD só leitura (Task 22) vêm antes do merge.

## Decisões fechadas (não reabrir)

- **D3 / P1-2 / I19b:** soma exata ao centavo pela régua líquida da I17b (`ValorAbertoLiquido.calcularCentavos`); nenhuma tolerância; a I18 (ajuste de centavos) não se aplica a título de grupo.
- **P0-1 / I19e / I19f / PI-7:** o sistema sugere só **grupo fechado no mesmo vencimento** (todos os títulos em aberto do `pesCod` na filial com `vencimento == vencimentoBoleto`); nunca subconjunto; título que falha I19c deixa o grupo **exibido com motivo e não confirmável**. K boletos iguais × títulos de mesmo valor ⇒ partição determinística `intercambiavel`. A analista confirma cada grupo.
- **P0-2 / I19g / PI-2:** composição manual com janela `0 ≤ vencBoleto − vencTitulo ≤ 10` dias (dia civil); Δ > 0 em algum título ⇒ aviso `TITULO_VENCE_ANTES_DO_BOLETO` reconhecido **no servidor** (padrão I15o, `WarningAcknowledgementRequiredError`).
- **P0-3 / I19d:** grupo que cruza filial aparece com `CRUZA_FILIAL`, não confirmável.
- **P0-4 / I19l / I19q:** borderô nasce na etapa `preparar_bordero` do L8 (entre `criarLote` e `importar`), write-ahead com marcador **antes** do `POST fin010`. Limpeza só do borderô que **nós criamos nesta remessa**, só com `vldHasRemessaPgto = 0` e lote nativo não finalizado; depois disso, `Alerta` `sispag-bordero-grupo-pendente`. **Nunca** `finalizarBordero`, `cancelarBordero` nem `fin146` sobre borderô de grupo (I19m).
- **P0-5:** sem flag, sem `off/shadow/on`; o vínculo da barra ao item de borderô **não** depende do modo I17k (`SISPAG_BIND_CODBAR_FILIAIS`); permissões do CLONEX (V1) e o primeiro `.RET` real (V6) são watchlist, não portão.
- **P1-1 / I19j / I19k:** N `ItemLote` (um por título, `grupoBoletoId`) que entram/saem/se movem juntos; na remessa, **um** item nativo de borderô; título de grupo nunca vai em `importarTitulos`.
- **P1-4 / PI-8:** formação automática põe o grupo inteiro no lote do **vencimento do boleto**; L6 mede o "vencido" do grupo pelo boleto (dia civil Brasília, ADR-0070). Órfão, retido ou com rejeição não resolvida não é lotado pelo cron.
- **P1-5 / PI-9 / I19r / I19s:** `PAGO` só com os N pagos; parte paga ⇒ `divergencia` + `sispag-baixa-divergente`; J rejeitado ⇒ N `REJEITADO`, grupo volta a "confirmado, sem lote" com situação `REJEITADO` + `sispag-bordero-grupo-pendente`; volta à remessa só por inclusão manual; o borderô antigo é relido: ausente/cancelado ⇒ novo; em `borderosPendentes` do lote novo ⇒ **reaproveita** (`BORDERO_REAPROVEITADO`); em cadastro fora dos pendentes ⇒ retirada com `BORDERO_ANTERIOR_NAO_RESOLVIDO`, sem tocar no antigo.
- **PI-5 / I19p(1):** grupo inelegível ao vivo na remessa **barra** a remessa antes de qualquer escrita (`GroupedBoletoNotEligibleAtRemittanceError`, 409).
- **PI-6 / I19t:** anular em lote `RASCUNHO` retira os N itens na mesma transação.
- **Escrita no ERP:** tentativa única (`postGenericOnce`) em toda escrita nova; sucesso = estado **observado na releitura** (H4: `importar` com `SUCESSO` sem item é falha ambígua); retry só em leitura, via `RetryExecutor`, nunca `setTimeout`.
- **Privacidade (I17j):** código de barras só mascarado 5+4 em banco, ledger, evento, log, alerta e resposta de API.
- **Logs e mensagens ao operador em português** (ADR-0042); identificadores e classes de erro em inglês.

## Fatos do código que moldam as tasks (verificados em 2026-10-20 neste worktree, base 0126920)

- Última migration = **0088** (`0088_sispag_ajuste_centavos.sql`, com `.test.ts`, `.integration.test.ts` e `migrations/rollbacks/0088_sispag_ajuste_centavos.rollback.sql`); próxima = **0089**. Migrations são descobertas por diretório (`migrations/MigrationFiles.ts` lista os `NNNN_*.sql` do nível de cima) e copiadas para `dist/` por `migrations/copy-to-dist.ts`: não há registro manual, mas o teste estático de cobertura de build é obrigatório (gotcha do `.sql` em `dist/`).
- `lote_pagamento_item` (0023): `doc_cod`/`tit_cod` `NOT NULL`, `UNIQUE (lote_id, fil_cod, doc_cod, tit_cod)`. Os N itens do grupo cabem sem mexer na UNIQUE (P1-1). Coluna nova `grupo_boleto_id` nula.
- `remessa_execucao.etapa` (0049) tem CHECK fixo `('criar_lote','importar','finalizar','gerar_remessa','concluido')`; `vincular_codbar` e `limpar_retirados` são etapas **só de memória** (`ORDEM_ETAPAS`, `RemessaService.ts:122-136`). `preparar_bordero` é **persistida** (ação `prepararBorderoDoGrupo`): a 0089 amplia o CHECK e `RemessaEtapa` (`domain/interface/sispag/RemessaExecucao.ts:14`) ganha o valor.
- O índice único parcial `WHERE estado = 'CONFIRMADO'` por título (I19i) não pode referenciar a tabela-mãe: `sispag_grupo_boleto_titulo` carrega um `estado` **denormalizado**, atualizado na mesma transação que o do grupo (CHECK/trigger de coerência na 0089).
- Exclusividade grupo × `DecisaoSugestaoBoleto CONFIRMADA` (mesmo boleto, mesmo título; I15q/I19c) cruza tabelas: nenhum índice a garante. Vale por advisory lock por boleto e por título dentro da transação do `confirmar` (dos dois lados: `GrupoBoletoService.confirmar` e `BoletoSuggestionService.confirmar`).
- Motivo de retirada pelo sistema vai em `dados.motivo` do evento `ITEM_REMOVIDO_SISTEMA` de `sispag_verificacao_evento` (sem CHECK de motivo); os motivos são o `SYSTEM_REMOVAL_REASON` (`SispagInterface.ts:738-751`). Origem da marca de retenção tem CHECK `titulo_bloqueio_duplicidade_origem_check` (0085/0086) e `DUPLICATE_HOLD_ORIGIN` (`SispagInterface.ts:700`). Alerta operacional: CHECK `alerta_tipo_check` (última versão na 0088) + `ALERTA_TIPO` (`domain/interface/operacao/Alerta.ts`), emitido por `domain/service/operacao/NotificacaoService.ts` (`emitir`, com janela diária como faz `AjusteCentavosTituloService.alertar`).
- `RemessaService.gerarRemessaSerializado` (`RemessaService.ts:282+`): dry-run = `!conexosWriteEnabled || !sispagLiveWriteEnabled || conexosDryRun`; o vínculo 1:1 é condicionado a `modoVinculo === ON` (`RemessaService.ts:742-748`). O vínculo do item de borderô precisa de caminho próprio, **fora** desse `if` (P0-5).
- `RemessaService` já resolve a conta pagadora do lote pelo `fin005` (`escolhida`, l.489–513) e persiste `gerNum` via `setChavesNativas` quando presente (l.640–647): é a fonte do `gerNum` (H2/H10). Ausente ⇒ falha antes do `POST fin010`.
- `RemessaService.sincronizarComErp` (l.1004–1184) monta `nossas` a partir de `lote.itens` (`fil:doc:tit`) e compara com `write.listarChavesDoLote`. **`ConexosSispagWriteClient.listarChavesDoLote` (l.594–631) mapeia uma linha sem `docCod` para `"{fil}::1"`** e `lerItensDoRascunho` (l.775–804) para `docCod ''`: um item de borderô hoje viraria uma chave falsa/estranho e travaria a retomada em `indeterminado`. As duas leituras precisam reconhecer `borCod` (chave `"{fil}:bor:{borCod}"`), e `nossas` passa a ser títulos avulsos ∪ `borCod`s do write-ahead dos grupos (I16h emendada); os N títulos de grupo saem de `nossas`.
- `RetiradaCodigoBarrasService.garantir` (l.189+) filtra os itens `BOLETO` do lote local e exige código no rascunho por `docCod:titCod` (I16c): os N itens de grupo, sem contrapartida nativa por título, seriam lidos como "código ausente". O grupo tem de ser tratado como **um** item nativo (`borCod`).
- `ConciliacaoRetornoService.conciliar` (l.300–321) e `SincronizacaoLoteService` (l.489–498) **descartam linha de retorno sem `docCod`** e chaveiam o evento por `docCod:titCod`. A linha do J de um item de borderô precisa ser casada pela chave nativa (fil/bnc/flp/its ou `borCod`) e espalhada nos N itens do grupo (I11i). O formato real da linha de detalhe do `fin052` para item de borderô **não foi lido** (só o processamento, gar 7, HML): medir na Task 1.
- `ConexosBaixaClient` (Permutas): `criarBordero` (l.67) **não** aceita `gerNum` nem marcador; `getBordero` (l.103) e `listBorderos` (l.310) **não** devolvem `vldHasRemessaPgto` nem campo de observação; **não existe** método de baixa simples (só `gravarBaixaPermuta`); `listBaixas`, `validarTituloBaixa`, `excluirBaixa`, `excluirBordero` servem como estão. Extensões têm de preservar o payload atual de Permutas byte a byte (teste de snapshot).
- `ConexosSispagWriteClient` **não** tem nada de `borderosPendentes` (`list`/`importar`). Corpos que funcionaram: `src/backend/jobs/probe-hml-boleto-agrupado.ts` (fases `criarBor`, `baixaBor`, `importar`, `codbar`, `apagarBor`).
- `VinculoCodigoBarrasService` (1053 linhas): `executar` (l.329), `vincularItem` (l.414), `reconhecerItemComCodigo` (l.675), `lerAberto` (l.742); régua `ValorAbertoLiquido` (`domain/libs/boleto/ValorAbertoLiquido.ts`). A sequência I17e (`validarCodigoBarras` → `confirmarCodigoBarras` → `editarItemDoRascunho` → releitura) é reaproveitável para o item de borderô sem duplicar.
- Carteira local (`TituloAPagar.valor`) = `titMnyValor` (`ConexosSispagClient.ts:403`), **não** o líquido: ver Questions/gaps G1.
- `FormacaoLotesService` (155 linhas): `desfazerAutomaticosVencidos` (`LotePagamentoRepository.ts:404-415`) compara `i.vencimento < hoje` por item; `listElegiveisParaFormacao` (`TituloAPagarRepository.ts:305`) não conhece grupos; log final `'automatic lot formation completed'` em inglês (código novo loga em português).
- `LotePagamentoService.cancelarLote` (l.534) é só local (I1): ver Questions/gaps G3 para o disparo L5 da limpeza.
- Modelo de ledger com marcador, compensação, retomada e alerta: `AjusteCentavosTituloService.ts` + `AjusteCentavosExecucaoRepository.ts` + `domain/libs/boleto/EtapaAjusteCentavos.ts`. Identidade Conexos (I-2): colunas `conexos_username`/`conexos_usn_cod` (0051).
- Rotas: `routes/sispag.ts` (1618 linhas); permissões por `exigirPermissao(PERMISSION.SISPAG_*)`; matriz de permissões testada em `http/routePermissions.test.ts`; limiter `buildSugestaoBoletoLimiter(options, escopo)` (`http/rateLimit.ts:149`, escopos `'confirmar' | 'copiar' | 'ajuste'`); schemas Zod em `domain/interface/sispag/SugestaoBoletoSchemas.ts`.
- Frontend: `src/frontend/app/sispag/page.tsx` (aba de títulos, 1770 linhas), `components/LoteCard.tsx` (lote, 1121 linhas), `SugestaoBoletoPainel.tsx`, `ReconhecerAvisoDialog.tsx`, `MotivoDecisaoDialog.tsx`, `RetirarDoLoteDialog.tsx`, `MoverParaLoteDialog.tsx`, `VinculoCodigoBarrasSelo.tsx`; cliente da API `src/frontend/lib/sispag.ts`; design system em `src/frontend/docs/design-system`.
- App em **0.71.0** (FE == BE). `pwsh` **não** está instalado nesta máquina: o bump do ciclo anterior foi feito à mão nos dois `package.json` + `CHANGELOG.md` (mesmo procedimento aqui, se continuar sem `pwsh`).

## Ground-truth plan (obrigatório: lógica monetária alimentada pelo Conexos)

**Status: PARCIAL.** A escrita (`fin010`, `borderosPendentes/importar`, vínculo, `.REM`, retorno) só é provável em HML (`sispag-boleto-agrupado-hml-achados.md`: borderô 252 → flp 48 → `PG191081.REM` → gar 7). Em PRD, só leitura:

| # | O que | Fonte nativa | Amostra | Tolerância | Chave | Task |
|---|---|---|---|---|---|---|
| GT1 | Sugestão I19e/f sobre a carteira e o pool reais × medição de 2026-10-19 (~220 casos 1→N, 40+ credores; PEDRONI 38883–38885 → 332841) | carteira persistida + pool DDA local + `fin064` | todas as filiais, boletos livres a vencer | PEDRONI presente e confirmável; zero subconjunto sugerido; contagens por motivo (`CRUZA_FILIAL`, aguardando alçada, `VALOR_ABERTO_INDISPONIVEL`) registradas | `ddcCod/ditCod` × `filCod/docCod/titCod` | Task 22 |
| GT2 | Régua líquida (I17b) × `valor` local (`titMnyValor`) nos títulos dos grupos sugeridos | `fin064` ao vivo | títulos de todo grupo sugerido no GT1 | 0 centavo (divergência = grupo que a sugestão mostraria e a confirmação recusaria) | `filCod/docCod/titCod` | Task 22 (alimenta G1) |
| GT3 | Primeiro `.RET` real do Itaú com item de borderô (V6): linha do J com chave em 183–202, N títulos `vldPago 1`, borderô `borVldFinalizado 1` | `fin052` + `fin064` + `fin010` | o primeiro grupo real pago | exato | `fil/bnc/flp/its`, `borCod` | Task 24 (pós-merge, watchlist) |

**SEM_GROUND_TRUTH em PRD:** a sequência de escrita I19l–q e a retomada I19s, cobertas pelas medições HML (Task 1) e pela prova HML ponta a ponta com o serviço de produção (Task 21). V1 (permissões do CLONEX) é conferência do maintainer (Task 22, opcional, não portão).

## Fases e dependências

```
Fase A (paralelas, sem dependência)   T1 (HML medições)  T2 (regras puras)  T3 (motor de sugestão)  T4 (etapas + situação)  T5 (erros nomeados)
Fase B                                T6 (migration 0089) ← T4        T7 (clients Conexos) ← T1 (nome do campo do marcador, forma da linha do retorno)
Fase C                                T8 (repositórios) ← T6
Fase D (paralelas entre si)           T9 (GrupoBoletoService) ← T2,T3,T5,T8      T10 (I15q na sugestão 1:1) ← T8
                                      T11 (lote manual) ← T2,T5,T8               T12 (formação automática + L6) ← T8
                                      T13 (RED BorderoGrupoBoletoService) ← T4,T5,T7,T8
Fase E                                T14 (GREEN Bordero…) ← T13
Fase F (paralelas entre si)           T15 (L8 na RemessaService) ← T14      T16 (barra no item de borderô) ← T7,T14
                                      T18 (retorno/sincronização) ← T7,T8
Fase G                                T17 (guarda I16 + retirada do grupo) ← T15,T16
Fase H                                T19 (rotas + Zod) ← T9,T10,T11,T17      T20 (frontend) ← T19
Fase I                                T21 (HML ponta a ponta) ← T15–T18      T22 (PRD só leitura) ← T9 (pode rodar em paralelo à Fase F)
Fase J                                T23 (ontologia/observabilidade/docs) ← T1–T22   T24 (rollout pós-merge, watchlist)   T25 (gates finais + PR)
```

Paralelismo: **Fase A inteira** em paralelo; na Fase D, T9/T10/T11/T12/T13 em paralelo (tocam arquivos distintos; T10 e T9 combinam o advisory lock por boleto/título: fixar a chave do lock na T8); na Fase F, T15/T16/T18 em paralelo (T15 e T16 tocam `RemessaService.ts` em trechos distintos: T16 entrega o método no `VinculoCodigoBarrasService`, T15 o chama). T22 pode rodar assim que a T9 estiver verde.

## Task list

### Task 1: Medições HML durante o TDD — campo do marcador, V2, V3, V5 e a linha do retorno do item de borderô
**Files to change:**
- `src/backend/jobs/probe-hml-boleto-agrupado.ts` (fases novas: `marcador`, `v2`, `v3`, `v5`, `retornoLinha`; mesmo esqueleto de fases, `trilha.jsonl`, **só HML**: recusa se a URL não for HML)
- `ontology/_inbox/sispag-boleto-agrupado-hml-achados.md` (seção "Medições do TDD, 2026-10-2x")
- `ontology/integrations/conexos.md` (linha 2 da tabela do borderô: nome real do campo de observação; linha 10: ordem da limpeza confirmada)

**Acceptance criteria:**
- [ ] **Marcador:** campo de observação do `fin010` que (a) aceita texto no `POST fin010` e (b) volta no `GET fin010/{fil}/{bor}` **e** é filtrável no `fin010/list` (`filterList`); nome, tamanho máximo e caixa (maiúscula?) registrados. Se nenhum campo atender (b), parar e abrir P0 no `_inbox` (G2): a I19s depende disso
- [ ] **V2:** título com baixa num borderô em cadastro segue `vldPago 0`/aberto no `fin064` e aparece nos pendentes do `fin015`? Tentar `importarTitulos` avulso desse título num lote HML: aceito ou recusado (registrar a mensagem). Resultado vira caso de teste da Task 15 (o avulso nunca é tentado por nós, I19k) e nota para a analista
- [ ] **V3:** borderô **importado** num rascunho → `DELETE finItemSispag` → releitura (ausente) → `excluirBaixa` × N → `excluirBordero` → releitura (ausente); registrar se o `excluirBaixa` é recusado enquanto o item existe (ordem I19q) e se o `DELETE` do item volta 200 com o item ainda presente
- [ ] **V5:** barra sintética do **mesmo banco** da conta (341) no item de borderô: código da modalidade "título próprio" aceito pelo `PUT finItemSispag` (esperado `6`); barra de outro banco com `7` (já provado) como controle
- [ ] **Linha do retorno:** leitura **só leitura** das linhas de detalhe do `fin052` da gar 7 (fil 2): campos presentes (`docCod`? `titCod`? `borCod`? `bxaCodSeq`? `itsCodSeq`?) e se o ERP devolve **uma** linha (o J) ou **N** (uma por baixa). Define a chave da Task 18
- [ ] Barras sintéticas (`domain/libs/boleto/CodigoBarrasSintetico.ts`); nenhuma linha completa na trilha (código mascarado 5+4); estado deixado em HML documentado
- [ ] Autorização explícita do maintainer antes de cada fase que escreve em HML

**Dependencies:** none (bloqueia o fechamento da Task 7 e da Task 18)

---

### Task 2: RED + GREEN — regras puras do grupo (I19a–d, I19g, I19h, I19u)
**Files to change:**
- `src/backend/domain/service/sispag/RegraGrupoBoleto.ts` (novo; mesmo lugar e estilo de `RegraSugestaoBoleto.ts`)
- `src/backend/domain/service/sispag/RegraGrupoBoleto.test.ts` (novo)
- `src/backend/domain/interface/sispag/GrupoBoletoInterface.ts` (novo: constantes tipadas `GRUPO_BOLETO_ESTADO = { CONFIRMADO, ANULADO, PAGO }`, `GRUPO_BOLETO_ORIGEM = { SUGERIDO, MANUAL }`, `MOTIVO_GRUPO_INELEGIVEL`, `AVISO_GRUPO = { TITULO_VENCE_ANTES_DO_BOLETO }`, tipos `GrupoBoleto`, `GrupoBoletoTitulo`)

**Acceptance criteria:**
- [ ] Testes escritos primeiro e falhando (RED comprovado no log da tarefa)
- [ ] I19a: N = 1 ⇒ `MENOS_DE_DOIS_TITULOS` (caminho 1:1, PI-1); `pesCod` diferentes ⇒ `CREDORES_DIFERENTES`; boleto com `docCod/titCod` do ERP ⇒ `BOLETO_VINCULADO_ERP`; par não `VIGENTE` e não confirmável no ato ⇒ `PAR_NAO_VIGENTE`
- [ ] I19b: soma em **centavos inteiros** com `ValorAbertoLiquido.calcularCentavos` (importada, não copiada); ±1 centavo ⇒ `SOMA_DIFERENTE` com Δ; qualquer título com líquido indisponível ⇒ `VALOR_ABERTO_INDISPONIVEL` (fail-closed); `valorBoleto` vem da decodificação **nossa** (`CodigoBarrasBoleto`), não do campo do DDA
- [ ] I19c: cada causa com motivo próprio: `NAO_LIBERADO` (exibido como "aguardando alçada"), `PAGO`, `INATIVO`, `FORMA_NAO_BOLETO`, `TEM_BOLETO_ERP`, `DECISAO_1_1_CONFIRMADA`, `MARCA_RETENCAO_ATIVA` (inclusive origem `GRUPO_BOLETO`), `EM_LOTE_COMPROMETIDO`, `EM_OUTRO_GRUPO`
- [ ] I19d: filiais diferentes ⇒ `CRUZA_FILIAL`
- [ ] I19g: janela por título `0..10` dias civis; −1 ou 11 ⇒ `FORA_DA_JANELA`; Δ > 0 em algum título ⇒ aviso `TITULO_VENCE_ANTES_DO_BOLETO` exigido; fixture com offset São Paulo não desloca o dia (UTC meia-noite, ADR-0070)
- [ ] I19h: `vencimentoBoleto < dataDebito` ⇒ `BOLETO_VENCIDO`; sem lote, referência = o próprio `vencimentoBoleto`
- [ ] I19u: `orfao(grupo, vivo)` devolve `{ orfao, motivo }` para boleto fora do pool, boleto com vínculo do ERP, título pago/inativo/com DDA do ERP, líquido ≠ snapshot
- [ ] Puro (sem I/O, log ou relógio: `hoje` entra como parâmetro); classes exportadas, métodos arrow, modificadores explícitos; saída sem linha completa (`JSON.stringify` sem 44/47 dígitos)
- [ ] `typecheck` e `lint` ok

**Dependencies:** none

---

### Task 3: RED + GREEN — motor da sugestão de grupos (I19e, I19f, PI-7)
**Files to change:**
- `src/backend/domain/service/sispag/MotorGrupoBoleto.ts` (novo; espelha `MotorSugestaoBoleto.ts`, puro)
- `src/backend/domain/service/sispag/MotorGrupoBoleto.test.ts` (novo)
- `src/backend/domain/service/sispag/__fixtures__/grupoBoleto.ts` (novo: PEDRONI, AR SOLUÇÕES, 333111, negativos)

**Acceptance criteria:**
- [ ] RED primeiro. Conjunto candidato = **todos** os títulos em aberto do `pesCod` na filial com vencimento civil **igual** ao do boleto; Σ == boleto ⇒ sugerido; Σ ≠ ⇒ nada (nunca subconjunto — teste com 4 títulos em que 3 somariam o boleto: zero sugestão)
- [ ] PI-7: conjunto fechado com Σ == boleto e um título em alçada ⇒ sugestão **presente** com `confirmavel = false` e motivo `NAO_LIBERADO`; o título nunca é removido para sugerir os demais (teste dedicado)
- [ ] Conjunto que cruza filial nunca é formado pela sugestão (a chave é `pesCod` × filial); a composição manual que cruza filial é recusada pela Task 2 com `CRUZA_FILIAL`
- [ ] I19f PEDRONI: K = 3 boletos de R$ 1.575,00 (mesmo `pesCod`, `emissorChave`, vencimento, valor) × 9 títulos de R$ 525,00 ⇒ 3 grupos `intercambiavel`, boletos ordenados por (`ddcCod`, `ditCod`), títulos por (vencimento, `docCod`, `titCod`), k-ésimo boleto com o k-ésimo bloco de 3; títulos de valores diferentes com K ≥ 2 ⇒ nenhuma sugestão
- [ ] Canônico 333111 (títulos 25/10, boleto 26/10) ⇒ **não** sugerido
- [ ] Boleto de grupo `CONFIRMADO` ou com `DecisaoSugestaoBoleto CONFIRMADA` não é candidato; título em grupo `CONFIRMADO` não entra em conjunto de outro boleto
- [ ] Determinístico (mesma entrada ⇒ mesma saída, ordem estável); complexidade O(T + B) por (filial, `pesCod`, vencimento) documentada
- [ ] `typecheck`/`lint` ok

**Dependencies:** none (usa a Task 2 quando existir; até lá, contrato de tipos)

---

### Task 4: RED + GREEN — etapas da execução do borderô e situação derivada do grupo
**Files to change:**
- `src/backend/domain/libs/boleto/EtapaBorderoGrupo.ts` + `.test.ts` (novo; modelo `EtapaAjusteCentavos.ts`)
- `src/backend/domain/libs/boleto/SituacaoGrupoBoleto.ts` + `.test.ts` (novo)

**Acceptance criteria:**
- [ ] Etapas tipadas: `marcador_gravado → bordero_criado → baixas_gravadas → bordero_conferido → importado → codbar_vinculado → concluido`; desvios `reaproveitado` (adoção do `borCod` antigo, I19s), `retirado` (I19p(3)), `limpo` (I19q), `limpeza_pendente` (Alerta, I19q pós-remessa), `indeterminado`, `failed` (transitória, I19p(2)), `simulado` (dry-run)
- [ ] `podeLimpar(etapa, { vldHasRemessaPgto, loteNativoFinalizado, reaproveitado })` verdadeiro só antes do lote nativo finalizado, com `vldHasRemessaPgto = 0` e borderô **criado nesta execução** (nunca reaproveitado)
- [ ] Transição inválida lança; terminais documentados
- [ ] Situação derivada (não persistida): `DISPONIVEL`, `EM_LOTE`, `EM_REMESSA`, `REJEITADO`, `RETIDO`, `DIVERGENTE`, `ORFAO` (+ `ANULADO`/`PAGO` do estado) com precedência explícita testada (ex.: órfão e retido ao mesmo tempo ⇒ a ordem fixada no teste); `REJEITADO` = última execução com J rejeitado e nenhuma execução posterior concluída
- [ ] `podeSerLotadoPeloCron(situacao)` falso para `ORFAO`, `RETIDO`, `REJEITADO` (I19j/I19r)
- [ ] Puro; constantes tipadas (nunca string crua); `typecheck`/`lint` ok

**Dependencies:** none

---

### Task 5: Erros nomeados do grupo
**Files to change:**
- `src/backend/domain/errors/GroupedBoletoSumMismatchError.ts` (422), `GroupedBoletoTitleIneligibleError.ts` (409), `GroupedBoletoCrossBranchError.ts` (422), `GroupedBoletoDueWindowError.ts` (422), `GroupedBoletoIndivisibleError.ts` (409), `GroupedBoletoNotEligibleAtRemittanceError.ts` (409), `GroupBorderoIncompleteError.ts` (409), `GroupedBoletoNotFoundError.ts` (404, anular/consultar id inexistente)
- `src/backend/domain/errors/GroupedBoletoErrors.test.ts` (novo)

**Acceptance criteria:**
- [ ] Teste primeiro; `message` em inglês, `userMessage` em português com as chaves (`docCod/titCod`, `borCod`, filial) e o código **mascarado**; `JSON.stringify` do erro sem 44/47 dígitos
- [ ] Status HTTP conforme a tabela "Erros nomeados" da I19; mapeados pelo `http/errorMiddleware.ts` como os erros SISPAG existentes (teste do middleware)
- [ ] `WarningAcknowledgementRequiredError` reutilizado (não duplicado) para o aviso da I19g
- [ ] `GroupedBoletoIndivisibleError` traz o id do grupo e os N títulos (a tela os lista)

**Dependencies:** none

---

### Task 6: Migration 0089 (grupo, títulos, execução, evento, item, CHECKs) e paridade de build
**Files to change:**
- `src/backend/migrations/0089_sispag_grupo_boleto.sql`
- `src/backend/migrations/0089_sispag_grupo_boleto.test.ts`
- `src/backend/migrations/0089_sispag_grupo_boleto.integration.test.ts`
- `src/backend/migrations/rollbacks/0089_sispag_grupo_boleto.rollback.sql` (+ caso em `migrations/rollbacks.test.ts`, se o teste enumerar)

**Acceptance criteria:**
- [ ] Reconferir o número livre em `origin/main` e nas branches abertas imediatamente antes de commitar (hoje 0089); se ocupado, renomear arquivos e referências na ontologia
- [ ] `sispag_grupo_boleto`: `id UUID PK`, `fil_cod`, `pes_cod`, `credor`, `emissor_chave`, `ddc_cod`, `dit_cod`, `numero_boleto`, `codbar_mascarado` (CHECK formato 5+4 da 0085), `valor_boleto_centavos` (> 0), `vencimento_boleto DATE`, `soma_titulos_centavos` (CHECK `= valor_boleto_centavos`), `origem` (CHECK `SUGERIDO|MANUAL`), `intercambiavel`, `avisos_reconhecidos JSONB`, `confirmacao_emissor_id` (FK `sispag_confirmacao_emissor_boleto`), `estado` (CHECK `CONFIRMADO|ANULADO|PAGO`), `confirmado_por` (CHECK `<> 'sistema'`), `confirmado_em`, `anulado_por`, `anulado_em`, `motivo_anulacao` (CHECK 10–500, preenchidos **só** em `ANULADO`; `anulado_por = 'sistema'` só com motivo de cascata do par), `pago_observado_em`, `versao`, timestamps
- [ ] `sispag_grupo_boleto_titulo`: `grupo_id` FK, `fil_cod`, `doc_cod`, `tit_cod`, `valor_liquido_centavos`, `vencimento DATE`, `estado` **denormalizado** com CHECK/trigger de igualdade ao do grupo; `UNIQUE (grupo_id, fil_cod, doc_cod, tit_cod)`
- [ ] Índices únicos parciais (I19i): `(ddc_cod, dit_cod) WHERE estado = 'CONFIRMADO'` no grupo; `(fil_cod, doc_cod, tit_cod) WHERE estado = 'CONFIRMADO'` nos títulos
- [ ] `sispag_grupo_boleto_execucao` (write-ahead do borderô, I19l/I19s; identidade I-2): `id`, `grupo_id`, `remessa_execucao_id` FK, `lote_id`, `fil_cod`, `bnc_cod`, `flp_cod`, `ger_num`, `marcador` (único, CHECK de formato), `bor_cod`, `bor_cod_reaproveitado_de` (execução anterior), `baixas JSONB` (`{docCod,titCod,bxaCodSeq,valorCentavos}`), `its_cod_seq`, `etapa` (CHECK com a lista da Task 4), `motivo`, `j_rejeitado_em`, `conexos_username`, `conexos_usn_cod`, `tentativas`, timestamps; índice único parcial "no máximo uma execução não terminal por grupo"
- [ ] `sispag_grupo_boleto_evento` só-inclusão (trigger de UPDATE/DELETE/TRUNCATE no padrão da `sispag_sugestao_boleto_evento` da 0084): tipos `GRUPO_CONFIRMADO`, `GRUPO_ANULADO`, `GRUPO_RETIRADO`, `BORDERO_PREPARADO`, `BORDERO_REAPROVEITADO`, `BORDERO_LIMPO`, `GRUPO_PAGO`, `GRUPO_DIVERGENTE`; `ator`, `em`, chaves, `codigo_mascarado` (CHECK 5+4), `dados JSONB`
- [ ] `lote_pagamento_item.grupo_boleto_id UUID NULL` FK + índice; `remessa_execucao` CHECK de `etapa` ampliado com `preparar_bordero` (DROP IF EXISTS + ADD, reaplicável)
- [ ] `titulo_bloqueio_duplicidade_origem_check` = origens atuais (pós-0086) + `GRUPO_BOLETO`; `alerta_tipo_check` = lista da 0088 + `sispag-bordero-grupo-pendente`
- [ ] Sem backfill (nenhuma linha existente muda)
- [ ] Teste estático: `.sql` coberto por `MigrationFiles`/`copy-to-dist` (incidente 2026-09-23); rollback presente
- [ ] Integração (Postgres de teste): dois grupos `CONFIRMADO` para o mesmo boleto ⇒ erro; mesmo título em dois grupos `CONFIRMADO` ⇒ erro; o mesmo depois de anular o primeiro ⇒ ok; soma ≠ boleto ⇒ erro; `confirmado_por = 'sistema'` ⇒ erro; máscara com 44 dígitos ⇒ erro; `UPDATE` no evento ⇒ erro; origem `GRUPO_BOLETO` e alerta novo aceitos, desconhecidos recusados; reexecutar a migration é no-op

**Dependencies:** Task 4 (lista de etapas)

---

### Task 7: Clients Conexos — borderô de grupo no `fin010` e `borderosPendentes` no `fin015`
**Files to change:**
- `src/backend/domain/client/ConexosBaixaClient.ts` + `.test.ts`
- `src/backend/domain/interface/permutas/Fin010Baixa.ts` (tipos novos/estendidos)
- `src/backend/domain/client/ConexosSispagWriteClient.ts` + `.test.ts`
- `src/backend/domain/interface/sispag/GrupoBoletoInterface.ts` (schemas Zod da linha de pendente e do item de borderô)

**Acceptance criteria:**
- [ ] `criarBordero` ganha `gerNum?` e `marcador?` (campo medido na Task 1) **opcionais**; sem eles o payload é **idêntico** ao atual (snapshot do corpo de Permutas, nenhum teste de Permutas muda de expectativa). Para o grupo, método novo `criarBorderoDoGrupo` com `postGenericOnce` (não-idempotente, sem retry)
- [ ] `gravarBaixaSimples` (novo, `POST fin010/baixas`, `postGenericOnce`): `responseData` da validação + chave + `gerNum`, juros/multa/desconto 0, `bxaMnyLiquido = bxaMnyValor`, `bxaVldCcorrente 0`, `bxaVldCorrenteDc 1` — corpo igual ao da fase `baixaBor` do probe (snapshot); `bxaCodSeq` validado por Zod
- [ ] `getBordero`/`listBorderos` devolvem `vldHasRemessaPgto`, `vlrTotalLiquido` e o campo do marcador (opcionais, sem quebrar a tela de Permutas); `buscarBorderosPorMarcador({ filCod, marcador })` (novo, leitura com `RetryExecutor`) devolve **todos** os que casam (o chamador decide "exatamente um")
- [ ] `listarBorderosPendentes({ filCod, bncCod, flpCod })` (`GET fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}`, leitura com retry, Zod `passthrough`)
- [ ] `importarBorderoPendente({ linha, filCodLote, bncCod, flpCod, bncCodFin015 })` (`postGenericOnce`): força **`itemy: 1`** e `op: 1` (teste: `itemy` da linha lida = 0 é sobrescrito); resposta nunca é tratada como prova
- [ ] `listarChavesDoLote` e `lerItensDoRascunho`: linha com `borCod` e sem `docCod` vira chave `"{fil}:bor:{borCod}"` / `ItemDoRascunho` com `borCod` (nunca `"{fil}::1"`); linhas de título inalteradas (testes existentes verdes)
- [ ] `lerItemDeBordero({ filCod, bncCod, flpCod, borCod })` (novo): item com o `borCod`, sem `docCod/titCod`, com `itsCodSeq`, `itsMnyValor`, modalidade; leitura incompleta ⇒ `RascunhoLeituraIncompletaError` (nunca "ausente")
- [ ] Nenhuma chamada nova a `finalizarBordero`, `cancelarBordero` ou `fin146` (teste estático: grep desses nomes fora de `permutas`/`ConexosBaixaClient.ts` e dos testes falha)
- [ ] Erros do ERP preservados em `ConexosError`; classificação determinística (4xx de negócio) × transitória (timeout/5xx) exposta para o serviço
- [ ] `ConexosWriteDisabledError` quando `conexosWriteEnabled=false`, antes de qualquer chamada de escrita

**Dependencies:** Task 1 (nome do campo do marcador; até lá, constante única `CAMPO_MARCADOR_FIN010` marcada como pendente)

---

### Task 8: Repositórios — grupo, execução, eventos, itens de lote em bloco, formação e marcas
**Files to change:**
- `src/backend/domain/repository/sispag/GrupoBoletoRepository.ts` + `.test.ts` + `.integration.test.ts` (novo)
- `src/backend/domain/repository/sispag/GrupoBoletoExecucaoRepository.ts` + `.test.ts` + `.integration.test.ts` (novo)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` + testes (`adicionarGrupo`, `removerGrupo`, `moverGrupo`, `desfazerAutomaticosVencidos`, `getLoteComItens` com `grupoBoletoId`)
- `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` + testes (`listElegiveisParaFormacao` exclui títulos de grupo `CONFIRMADO`; `listGruposParaFormacao` novo)
- `src/backend/domain/repository/sispag/BloqueioDuplicidadeRepository.ts` + testes (criar N marcas `GRUPO_BOLETO` numa transação; encerrar as do grupo)
- `src/backend/domain/interface/sispag/SispagInterface.ts` (`DUPLICATE_HOLD_ORIGIN.GRUPO_BOLETO`, `SYSTEM_REMOVAL_REASON.GRUPO_BOLETO_FALHOU` e `.BORDERO_ANTERIOR_NAO_RESOLVIDO`, `ItemLote.grupoBoletoId`, listas `MOTIVOS_RETIRADA_CODIGO_BARRAS`/`ORIGENS_RETENCAO_CODIGO_BARRAS` com a origem nova para o reconhecimento de resíduo I16h)
- `src/backend/domain/interface/operacao/Alerta.ts` (`ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE`)

**Acceptance criteria:**
- [ ] SQL parametrizado (`$1…`), sem interpolação; todos `@injectable()`; métodos arrow
- [ ] `GrupoBoletoRepository`: `inserirConfirmado` (grupo + N títulos + evento numa transação; conflito no índice parcial ⇒ devolve o existente quando boleto e títulos são os mesmos, senão erro tipado), `anular` (estado no grupo **e** nos títulos, `versao + 1`, evento), `marcarPago`, `buscarPorId`, `listarConfirmados({ filCod? })`, `buscarConfirmadoPorBoleto`, `buscarConfirmadoPorTitulo`, `listarEventos`; chave do advisory lock por boleto e por título exportada (usada também pela Task 10)
- [ ] `GrupoBoletoExecucaoRepository`: `abrir` (write-ahead com marcador **antes** de qualquer `POST`; conflito ⇒ devolve a não terminal), `registrarBorCod`, `registrarBaixa`, `registrarEtapa`, `ultimaPorGrupo`, `ultimaRejeitadaPorGrupo`, `listarPorRemessa`, `marcarJRejeitado`; grava `conexos_username`/`conexos_usn_cod`
- [ ] `adicionarGrupo`/`removerGrupo`/`moverGrupo` executam os N itens **numa transação** com `versao + 1` do(s) lote(s); falha injetada no N-ésimo item desfaz os anteriores (integração)
- [ ] `desfazerAutomaticosVencidos`: item com `grupo_boleto_id` usa `vencimento_boleto` do grupo, não o do item (integração: grupo manual com título vencido ontem e boleto amanhã **não** desfaz o lote)
- [ ] Marcas `GRUPO_BOLETO`: N numa transação; `encerrarDoGrupo(grupoId)` ao anular/pagar
- [ ] Nenhum `process.env`; nenhum código completo em coluna nenhuma

**Dependencies:** Task 6

---

### Task 9: `GrupoBoletoService` — sugerir, confirmar (anti-TOCTOU, idempotência) e anular (I19e–i, I19t, I19u)
**Files to change:**
- `src/backend/domain/service/sispag/GrupoBoletoService.ts` + `.test.ts` (novo; RED primeiro)

**Acceptance criteria:**
- [ ] Testes primeiro e falhando; `@injectable()`, métodos arrow, `EnvironmentProvider` (nenhum `process.env`)
- [ ] `sugerir({ filCod? })`: lê pool, carteira, grupos e decisões **locais** (zero chamada ao Conexos, espião prova); calcula pelo `MotorGrupoBoleto`; leitura que falha não vira "sem grupo" (erro); nada persistido
- [ ] `confirmar({ origem, ddcCod, ditCod, titulos[], reconheceAvisos?, ator })`: ator do JWT, nunca `sistema`; reavalia I19a–d/h **dentro da transação**, sob advisory lock por boleto e por título (nunca do cache da sugestão); `SUGERIDO` exige que o conjunto recalculado seja exatamente o enviado e `confirmavel`; `MANUAL` aplica a janela da I19g; valor líquido pela fonte decidida em G1 (default: `fin064` ao vivo dos N títulos, leitura antes da transação, snapshot gravado)
- [ ] Erros: `GroupedBoletoSumMismatchError`, `GroupedBoletoTitleIneligibleError`, `GroupedBoletoCrossBranchError`, `GroupedBoletoDueWindowError`, `WarningAcknowledgementRequiredError` (aviso exigido e não reconhecido, conferido contra a avaliação **recalculada**)
- [ ] Par (`pesCod`, `emissorChave`) criado `VIGENTE` na mesma transação, ou reutilizado (no-op no par)
- [ ] Idempotência: confirmar de novo o mesmo (boleto, títulos) devolve o grupo existente sem evento novo; corrida de duas confirmações (teste de integração concorrente) ⇒ um grupo, o outro recebe o existente ou erro tipado
- [ ] `anular({ grupoId, motivo, ator })`: motivo 10–500; idempotente sobre `ANULADO`; `PAGO` não se anula; em lote `RASCUNHO` retira os N itens na mesma transação (PI-6); em lote comprometido devolve aviso (a remessa retira, Task 15); encerra marcas `GRUPO_BOLETO`; evento `GRUPO_ANULADO`
- [ ] `anularPorRevogacaoDoPar(parId, tx)` para a cascata I15l(2) (chamado pela Task 10), ator `sistema` com motivo fixo
- [ ] `listar({ filCod })` devolve grupos com situação derivada (Task 4) e órfão (I19u) recalculado na leitura; nunca some grupo em silêncio
- [ ] Logs em português, código mascarado; casos PEDRONI (sugerido → confirmado), 333111 (manual com aviso), ±R$ 0,01, dois credores, outra filial, título em alçada (exibido, não confirmável), título em outro grupo, título com decisão 1:1

**Dependencies:** Task 2, Task 3, Task 5, Task 8

---

### Task 10: Sugestão 1:1 conhece o grupo (I15e(4), I15m `EM_GRUPO`, I15q, cascata I15l(2))
**Files to change:**
- `src/backend/domain/service/sispag/MotorSugestaoBoleto.ts` + `.test.ts`
- `src/backend/domain/service/sispag/BoletoSuggestionService.ts` + `.test.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts` (ou o arquivo de tipos da sugestão: `SituacaoSugestaoTitulo` + `EM_GRUPO`)

**Acceptance criteria:**
- [ ] RED primeiro. Título em grupo `CONFIRMADO` ⇒ desfecho `EM_GRUPO`, `confirmavel = false`, com o id do grupo; boleto de grupo `CONFIRMADO` não é candidato de nenhum título (exclusão (4))
- [ ] `confirmar` 1:1 recusa título ou boleto em grupo `CONFIRMADO` (`BoletoSuggestionNotAvailableError` com motivo), sob o **mesmo** advisory lock da Task 8 (teste de corrida grupo × decisão)
- [ ] `revogarPar` anula na mesma transação os grupos `CONFIRMADO` do par (via `GrupoBoletoService.anularPorRevogacaoDoPar`); rollback da revogação desfaz a anulação (integração)
- [ ] Os testes existentes do motor e do serviço continuam verdes sem mudança de expectativa (sem grupo, comportamento idêntico)
- [ ] `typecheck`/`lint` ok

**Dependencies:** Task 8 (e Task 9 para a cascata; pode começar pelo motor)

---

### Task 11: Lote manual — incluir/mover/retirar o grupo inteiro (I19j, I2/I3/I4 por título, L2/L3)
**Files to change:**
- `src/backend/domain/service/sispag/LotePagamentoService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/LotePagamentoApiView.ts` (grupo no shape do lote)

**Acceptance criteria:**
- [ ] RED primeiro. `incluirGrupo({ loteId, grupoId, mover?, ator, versaoEsperada })`: grupo `CONFIRMADO`, não órfão, sem marca ativa, lote `RASCUNHO` da mesma filial; I2 por título com a re-leitura Conexos já usada por `incluirTitulo` (fora do lock); I3 por título; N itens `modalidade = BOLETO` com `grupoBoletoId` numa transação; I19h revalidada com a `dataDebito` do lote quando houver
- [ ] Grupo com J rejeitado é incluível à mão (I19r); o aviso "resolva o borderô antigo no Conexos" volta na resposta
- [ ] `removerTitulo`, `retirarDoLote` e `incluirTitulo` com `mover: true` sobre título de grupo ⇒ `GroupedBoletoIndivisibleError` (409); `incluirTitulo` avulso de título em grupo `CONFIRMADO` ⇒ `GroupedBoletoTitleIneligibleError`
- [ ] `removerGrupo` e `moverGrupo` (lote destino `RASCUNHO`, mesma filial) agem nos N itens numa transação, `versao` dos dois lotes
- [ ] `finalizarLote`: título do grupo inelegível (I2) barra a finalização listando o **grupo** (nunca finaliza parte, nunca retira em silêncio)
- [ ] `cancelarLote`: comportamento de G3 (default: cancela local; se houver execução de grupo com borderô criado e rascunho nativo aberto, agenda `limparBorderoDoGrupo` **depois do commit**; falha ⇒ `Alerta`) — implementado só depois da resposta de G3
- [ ] API view: grupo como um bloco `{ grupoId, codbarMascarado, valorBoleto, vencimentoBoleto, credor, situacao, titulos[] }` + os itens com `grupoBoletoId`
- [ ] Logs em português; testes existentes verdes

**Dependencies:** Task 2, Task 5, Task 8

---

### Task 12: Formação automática e L6 com o grupo como unidade (P1-4, PI-8)
**Files to change:**
- `src/backend/domain/service/sispag/FormacaoLotesService.ts` + `.test.ts`
- (SQL na Task 8: `listGruposParaFormacao`, `desfazerAutomaticosVencidos`)

**Acceptance criteria:**
- [ ] RED primeiro. Grupo `CONFIRMADO` disponível entra inteiro no lote de boletos da (filial × **vencimento do boleto**), na mesma transação dos títulos avulsos daquele lote, ou não entra; janela "a vencer ≤ 7 dias" medida pelo boleto
- [ ] Título de grupo nunca entra avulso (teste com grupo e títulos avulsos do mesmo credor no mesmo dia)
- [ ] Grupo `ORFAO`, `RETIDO` ou `REJEITADO` (situação da Task 4) não é lotado (I19j/I19r)
- [ ] L6: grupo manual com título vencendo antes do boleto não desfaz o lote no dia do título; desfaz no dia seguinte ao do boleto (dia civil Brasília)
- [ ] Log da rodada em português, com contagem de grupos lotados
- [ ] Testes existentes da formação verdes

**Dependencies:** Task 8 (situação da Task 4)

---

### Task 13: RED — `BorderoGrupoBoletoService` (preparar e limpar; casos canônicos e negativos)
**Files to change:**
- `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts` (só assinatura) + `.test.ts` (novo)

**Acceptance criteria:**
- [ ] Um teste por linha da tabela de reconhecimento da emenda de `retomada-remessa-sispag.md` (marcador sem `borCod` e nenhum borderô ⇒ cria; exatamente um ⇒ adota; dois ou mais ⇒ `indeterminado`; parte das baixas ⇒ completa só as faltantes; baixa de título alheio ⇒ `indeterminado`; completo não importado ⇒ `importar`; item com o `borCod` no rascunho ⇒ pula; borderô finalizado antes da remessa ⇒ `indeterminado` + `Alerta`; J rejeitado antes com antigo ausente/cancelado ⇒ cria; antigo em `borderosPendentes` ⇒ **reaproveita** sem segundo `POST fin010`; antigo em cadastro fora dos pendentes ou com baixas divergentes ⇒ retirada `BORDERO_ANTERIOR_NAO_RESOLVIDO` sem tocar no antigo)
- [ ] Sequência exata do caso PEDRONI (client mockado): marcador gravado → `POST fin010` (`filCod` do lote, `borVldTipo 2`, `borVldFinalizado 0`, `borDtaMvto = dataDebito`, `gerNum`, marcador) → `borCod` persistido → 3 × (`validarTituloBaixa` → `gravarBaixaSimples`) → releitura: 3 baixas dos títulos esperados e `vlrTotalLiquido == 1575,00` em centavos → `listarBorderosPendentes` contém o `borCod` → `importarBorderoPendente` com `itemy: 1` → releitura: item com o `borCod`, sem `docCod/titCod`, `itsMnyValor == valorBoleto`
- [ ] `gerNum` ausente ⇒ falha **antes** do `POST` (nada escrito); `BORDERO_NAO_PENDENTE` ⇒ determinística; `importar` `SUCESSO` sem item ⇒ ambígua (`GroupBorderoIncompleteError`, nunca sucesso)
- [ ] I19p(1): grupo inelegível ao vivo ⇒ `GroupedBoletoNotEligibleAtRemittanceError` com zero escrita (espião em todos os `*Once`)
- [ ] I19p(2): timeout/5xx depois do borderô ⇒ execução `failed`, borderô preservado, nenhuma limpeza
- [ ] I19p(3) + I19q: falha determinística ⇒ devolve `retirar` com o motivo; `limpar` faz `DELETE` do item (se importado) → releitura → `excluirBaixa` × N → `excluirBordero` → releitura; sucesso = ausência observada; borderô reaproveitado ⇒ só o item nativo sai; `vldHasRemessaPgto = 1` ou lote nativo finalizado ⇒ nenhuma exclusão + `Alerta` `sispag-bordero-grupo-pendente`
- [ ] Dry-run: monta e loga, zero escrita, execução `simulado`
- [ ] Nunca `finalizarBordero`/`cancelarBordero`/`fin146` (espião)
- [ ] Testes **falham** antes da Task 14

**Dependencies:** Task 4, Task 5, Task 7, Task 8

---

### Task 14: GREEN — `BorderoGrupoBoletoService` (write-ahead, retomada I19s, limpeza I19q)
**Files to change:**
- `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts`
- (sem registro manual no container: autowiring do tsyringe como os demais serviços SISPAG; **nada** em `appContainer.ts`/`bootstrapAppContainer`)

**Acceptance criteria:**
- [ ] Task 13 verde; `@injectable()`, métodos arrow, modificadores explícitos
- [ ] Métodos públicos: `conferirAntesDaEscrita({ lote, grupos })` (I19p(1), só leitura: `fin064` dos títulos, pool, par), `preparar({ lote, remessaExecucao, bncCod, flpCod, gerNum, dataDebito, grupo })`, `limpar({ execucao, motivo })`
- [ ] Intenção gravada antes de cada chamada de escrita, resultado depois; `RetryExecutor` só em leitura
- [ ] Identidade Conexos (I-2) gravada na execução; eventos `BORDERO_PREPARADO`/`BORDERO_REAPROVEITADO`/`BORDERO_LIMPO`
- [ ] Logs em português por etapa, com `grupoId`, `borCod`, `flpCod` e código mascarado
- [ ] Arquivo abaixo do limite de tamanho do projeto (sem inchar o `RemessaService`, 2037 linhas)
- [ ] `typecheck`, `lint`, `test` verdes

**Dependencies:** Task 13

---

### Task 15: L8 — etapa `preparar_bordero` na `RemessaService` e retomada com `borCod` (I19k, I19l, I19n, I19s, I19t)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` + `.test.ts`
- `src/backend/domain/interface/sispag/RemessaExecucao.ts` (`RemessaEtapa` + `preparar_bordero`)
- `src/backend/domain/repository/sispag/RemessaExecucaoRepository.ts` + teste (aceita a etapa nova)

**Acceptance criteria:**
- [ ] RED primeiro. `ORDEM_ETAPAS`: `criar_lote → preparar_bordero → importar → vincular_codbar → limpar_retirados → finalizar → gerar_remessa → concluido`; `preparar_bordero` **persistida** no ledger
- [ ] Antes de qualquer escrita (junto do preflight de destinos, antes do `criarLote`): `conferirAntesDaEscrita` dos grupos do lote; inelegível ⇒ 409, ledger sem `criarLote`
- [ ] Grupo anulado com o lote comprometido: a remessa retira os N itens antes do `finalizar` (espelho I17l); lote nativo já finalizado ⇒ erro nomeado
- [ ] `montarItensImport` exclui os títulos de grupo (I19k); teste: lote com 2 avulsos + 1 grupo de 3 ⇒ `importarTitulos` recebe 2, `importarBorderoPendente` 1
- [ ] `sincronizarComErp`: `nossas` = avulsos ∪ `"{fil}:bor:{borCod}"` das execuções do lote; grupo sem item no rascunho ⇒ retoma em `preparar_bordero` (reconhecimento I19s); borderô de outra execução/terceiro ⇒ estranho ⇒ `indeterminado`
- [ ] Retirada determinística devolvida pela Task 14 passa pela guarda (Task 17) com os N itens e o motivo; a remessa segue com os demais
- [ ] `valorFinal`/`valorTotal` continuam somando os itens locais (Σ do grupo == boleto)
- [ ] Dry-run (`sispagLiveWriteEnabled=false` ou `conexosDryRun=true`): nenhuma chamada de escrita do grupo
- [ ] V2 (Task 1) refletido: nenhum caminho importa título de grupo avulso
- [ ] Testes existentes da `RemessaService` verdes sem mudança de expectativa para lote sem grupo

**Dependencies:** Task 14

---

### Task 16: Barra no item de borderô (I19o, I17o) independente do modo I17k
**Files to change:**
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts` + `.test.ts` (método `vincularItemDeBordero`, reusando a sequência I17e já existente, sem duplicar)
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts` + `.test.ts` (variante "item de borderô")
- `src/backend/domain/libs/cnab/RemessaCnabValidator.ts` + `.test.ts` (J de borderô sem `docCod/titCod`)
- `src/backend/domain/service/sispag/RemessaService.ts` (chamada, fora do `if (modoVinculo === ON)`)

**Acceptance criteria:**
- [ ] RED primeiro. Elegibilidade: grupo `CONFIRMADO` não órfão + par `VIGENTE` + boleto relido do pool (sem decisão por título, I17a ⇒ I19o); valor pela I19b **e** `== itsMnyValor` do item; datas pela I19g/h; a I17n não se aplica (teste: o import do borderô nunca usa `titMnyLiquido`)
- [ ] Modalidade `7` se banco da barra ≠ banco do lote; `6` se igual (valor fixado pela V5 da Task 1)
- [ ] Roda com `SISPAG_BIND_CODBAR_FILIAIS` = `off` em todas as filiais (teste explícito, P0-5); `sispagLiveWriteEnabled=false` ⇒ não roda
- [ ] I17d (`itsMnyVlrPgtoResult == valorBoleto`), I17f, I17i, I17j inalteradas; falha transitória ⇒ `GroupBorderoIncompleteError` (retomável, nunca retira); determinística ⇒ retirada do grupo (Task 17)
- [ ] I17m: guarda do `.REM` reconhece o J do item de borderô (barra == pagamento do J == total do borderô); fixture do `PG191081.REM` HML
- [ ] Código só mascarado em log/evento/erro

**Dependencies:** Task 7, Task 14

---

### Task 17: Guarda I16 e retirada do grupo inteiro (I16a/d/d.1/e/h, I19p(3), I19q)
**Files to change:**
- `src/backend/domain/service/sispag/RetiradaCodigoBarrasService.ts` + `.test.ts`
- `src/backend/domain/libs/boleto/AnaliseCodigoBarrasRepetido.ts` + `.test.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` (`retirarGrupoPeloSistema`: N itens + N marcas + eventos numa transação) + teste

**Acceptance criteria:**
- [ ] RED primeiro. O grupo conta como **um** item nativo (`borCod`): os N itens locais não são lidos como "código ausente"; item de borderô sem barra antes do `finalizar` aborta como hoje (ADR-0040)
- [ ] I16a: a barra do grupo repetida num título avulso ⇒ repetição detectada; I16d.1: o item de borderô de grupo confirmado conta como "com decisão humana vigente" no desempate
- [ ] Retirar o item de borderô retira os N `ItemLote`, cria N marcas `GRUPO_BOLETO`, eventos `ITEM_REMOVIDO_SISTEMA` com `dados.motivo` = `GRUPO_BOLETO_FALHOU` ou `BORDERO_ANTERIOR_NAO_RESOLVIDO`, evento `GRUPO_RETIRADO`, e dispara `limpar` só para borderô criado nesta remessa (nunca o antigo de J rejeitado)
- [ ] I16h: resíduo de grupo retirado = item com `borCod` cujo grupo tem as marcas **e** o evento do sistema neste lote; outro `borCod` ⇒ intruso
- [ ] I16e: mensagem cita `borCod`, os títulos do grupo e o código mascarado
- [ ] Limpeza com falha parcial fecha (não segue para `finalizarLote`); a retomada termina a limpeza
- [ ] Testes existentes da guarda verdes

**Dependencies:** Task 15, Task 16

---

### Task 18: Retorno e sincronização do grupo (I19r, I11i)
**Files to change:**
- `src/backend/domain/service/sispag/ConciliacaoRetornoService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/SincronizacaoLoteService.ts` + `.test.ts`
- `src/backend/domain/service/sispag/DecisaoStatusLote.ts` + `.test.ts`
- `src/backend/domain/service/sispag/GrupoBoletoService.ts` (fechamento: `PAGO`, divergente, rejeitado)

**Acceptance criteria:**
- [ ] RED primeiro. Linha de retorno do item de borderô (formato medido na Task 1) casada pela chave nativa e espalhada nos N itens do grupo; linha sem `docCod` deixa de ser descartada quando casa um grupo; continua descartada quando não casa nada (comportamento atual)
- [ ] N títulos `PAGO` no `fin064` ⇒ grupo `PAGO`, `pago_observado_em`, evento `GRUPO_PAGO`, marcas encerradas; `borVldFinalizado` só corrobora (nível 4 da I11)
- [ ] Parte paga ⇒ `divergencia` nos N + `Alerta` `sispag-baixa-divergente` + evento `GRUPO_DIVERGENTE`; nunca "parcialmente pago"
- [ ] J rejeitado ⇒ N `REJEITADO`, lote `RETORNADO`, execução `j_rejeitado_em`, grupo com situação `REJEITADO` + `Alerta` `sispag-bordero-grupo-pendente` (detalhe com `borCod`, filial, títulos e o que fazer; sem código completo); nenhuma escrita no ERP
- [ ] Sincronização idempotente (rodar duas vezes não duplica evento nem alerta: janela diária do `NotificacaoService`)
- [ ] Testes existentes de conciliação/sincronização verdes

**Dependencies:** Task 7 (e a medição da linha do retorno na Task 1), Task 8

---

### Task 19: Rotas, Zod, permissões e rate limit
**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.grupoBoleto.test.ts` (novo)
- `src/backend/domain/interface/sispag/GrupoBoletoSchemas.ts` (novo, Zod)
- `src/backend/http/rateLimit.ts` (escopo `'grupo'` em `buildSugestaoBoletoLimiter`) + teste
- `src/backend/http/routePermissions.test.ts`

**Acceptance criteria:**
- [ ] `GET /sispag/grupos-boleto/sugestoes?filCod=` (`sispag:ver`), `GET /sispag/grupos-boleto?filCod=` (`sispag:ver`, com situação e órfão), `POST /sispag/grupos-boleto/confirmar` (`sispag:executar`, limiter), `POST /sispag/grupos-boleto/:id/anular` (`sispag:executar`, motivo 10–500), `POST /sispag/lotes/:id/grupos` (incluir, `mover` opcional), `DELETE /sispag/lotes/:id/grupos/:grupoId` (`sispag:executar`)
- [ ] Zod em body, params e query; `filCod` passa pelo `filialAuthz` existente; ator vem do JWT, nunca do body
- [ ] Erros nomeados chegam com status e `userMessage` (teste por erro); resposta sem código completo
- [ ] Matriz de `routePermissions.test.ts` atualizada; usuário só `sispag:ver` recebe 403 nas escritas
- [ ] PatternGuardian sem P0 no delta

**Dependencies:** Task 9, Task 10, Task 11, Task 17

---

### Task 20: Frontend — sugestão de grupos, composição manual, grupo no lote, situações, anulação e alertas
**Files to change:**
- `src/frontend/lib/sispag.ts` + teste (tipos e cliente das rotas novas)
- `src/frontend/app/sispag/components/grupoBoleto.ts` + `.test.ts` (novo: tipos, rótulos de situação e motivo em português)
- `src/frontend/app/sispag/components/GrupoBoletoPainel.tsx` + `.test.tsx` (novo: sugestões, motivo de não confirmável, confirmar, anular)
- `src/frontend/app/sispag/components/ComporGrupoBoletoDialog.tsx` + `.test.tsx` (novo: boleto + títulos, soma ao vivo, aviso com `ReconhecerAvisoDialog`)
- `src/frontend/app/sispag/components/GrupoBoletoLinha.tsx` + `.test.tsx` (novo: uma linha expansível no lote)
- `src/frontend/app/sispag/components/LoteCard.tsx`, `RetirarDoLoteDialog.tsx`, `MoverParaLoteDialog.tsx`, `SugestaoBoletoPainel.tsx` (`EM_GRUPO`) + testes
- `src/frontend/app/sispag/page.tsx` (aba de títulos: título de grupo marcado e não selecionável avulso)

**Acceptance criteria:**
- [ ] Testes primeiro. Sugestão mostra credor, boleto mascarado, valor, vencimento, títulos e soma; `confirmavel = false` mostra o motivo ("aguardando alçada", "não suportado: títulos de filiais diferentes, pagar à mão") sem botão de confirmar; `intercambiavel` explicado em uma linha
- [ ] Composição manual: soma ao vivo com diferença em centavos; fora da janela de 10 dias desabilita com motivo; aviso de vencimento antes do boleto exige reconhecimento explícito (o servidor revalida)
- [ ] No lote, o grupo é **uma** linha (boleto mascarado, total, credor, vencimento do boleto, situação) que expande os N títulos; retirar/mover age no grupo; tentativa sobre um título mostra a `userMessage` do 409
- [ ] Situações `DISPONIVEL`, `EM_LOTE`, `EM_REMESSA`, `REJEITADO` (com "resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo"), `RETIDO`, `DIVERGENTE`, `ORFAO`; anulação com `MotivoDecisaoDialog` (10–500); aviso de grupo anulado em lote comprometido
- [ ] Ações de escrita só para `sispag:executar`; botões desabilitados durante a chamada
- [ ] Nenhum código completo na tela além do que já é exibido hoje
- [ ] Tokens/componentes do design system (`src/frontend/docs/design-system`); `npm run lint`/`typecheck`/`test` do frontend verdes
- [ ] **DesignSystemReviewer gate** aprovado

**Dependencies:** Task 19

---

### Task 21: Prova HML ponta a ponta com o serviço de produção (canônico AR SOLUÇÕES, V3 e V7)
**Files to change:**
- `src/backend/jobs/probe-hml-boleto-agrupado-e2e.ts` + `.test.ts` (novo; usa `hmlEnvFile.ts`; **só HML**, recusa URL que não seja HML; teste prova a recusa)
- `ontology/_inbox/sispag-boleto-agrupado-hml-achados.md` (resultados)
- `ontology/_inbox/_watchlist.md` (V7: qual caminho é o comum)

**Acceptance criteria:**
- [ ] Roda `GrupoBoletoService` + `RemessaService.gerarRemessa` reais (não chamadas avulsas) contra HML com os clients reais
- [ ] Canônico: 2 títulos do mesmo credor → grupo confirmado → lote → `preparar_bordero` → 1 item de borderô → barra (modalidade 7) → `finalizar` → `.REM` com **um** J (barra == pagamento == Σ) → retorno sintético `00` sem J-52 (H8) → N títulos `vldPago 1`, borderô finalizado pelo ERP, grupo `PAGO`
- [ ] Falha determinística injetada depois do import (ex.: barra recusada) ⇒ grupo retirado, borderô limpo e **ausente** na releitura (V3 pelo código de produção)
- [ ] Retomada: processo interrompido depois do `POST fin010` com a resposta descartada ⇒ a retomada acha o borderô pelo marcador e não cria outro
- [ ] V7: retorno sintético de rejeição ⇒ grupo `REJEITADO` + `Alerta`; inclusão manual num lote novo ⇒ o borderô antigo é reaproveitado se aparecer em `borderosPendentes`, ou o grupo é retirado com `BORDERO_ANTERIOR_NAO_RESOLVIDO` se não aparecer; nunca dois borderôs vivos para o grupo (conferido no `fin010/list`)
- [ ] Barras sintéticas; estado deixado em HML documentado; autorização explícita do maintainer antes de rodar
- [ ] **Bloqueia o merge** (não há flag: o merge é o rollout)

**Dependencies:** Task 15, Task 16, Task 17, Task 18

---

### Task 22: Medição PRD só leitura — GT1/GT2 (e V1 opcional)
**Files to change:**
- `src/backend/jobs/validate-sispag-boleto-agrupado-v1.ts` (novo, **somente leitura**)
- `src/backend/jobs/validate-sispag-boleto-agrupado-v1.test.ts` (prova zero escrita: espião em `*Once`/`deleteGeneric`/`criarBordero*`/`importar*`)
- `ontology/_inbox/sispag-boleto-agrupado-hml-achados.md` (seção "PRD só leitura" com os números)

**Acceptance criteria:**
- [ ] GT1: roda o `MotorGrupoBoleto` sobre carteira + pool reais; registra grupos sugeridos, confirmáveis, não confirmáveis por motivo, intercambiáveis e cruzados; PEDRONI 38883–38885 × 332841 presente (se ainda em aberto) ou justificada a ausência; zero subconjunto
- [ ] GT2: para cada título dos grupos sugeridos, `fin064` ao vivo pela régua líquida × `valor` local; quantos grupos a confirmação recusaria (alimenta G1)
- [ ] V1 (opcional, não portão): permissão do CLONEX para `fin010` borderô/baixa e `fin015 borderosPendentes` lida pela matriz (`ger014`) ou pedida à Columbia; aviso no topo do job de que o login derruba a sessão viva (modelo `probe-prd-readonly-permissao-fin015.ts`)
- [ ] Roda com `databaseConnectionString=""` quando não precisa do banco, sem contaminar a sessão do robô; fora do horário de remessa, com OK do maintainer; saída sem código completo; datas com `at time zone 'UTC'`
- [ ] **Bloqueia o merge** (GT1/GT2); V1 não

**Dependencies:** Task 9 (pode rodar em paralelo às Fases F–H)

---

### Task 23: Ontologia, observabilidade e documentação (fechamento documental)
**Files to change:**
- `ontology/business-rules/boleto-agrupado-sispag.md`, `ontology/entities/grupo-boleto.md`, as 5 ações de `ontology/actions/sispag/`, as emendas listadas no cabeçalho (`implementation_status` → `implemented` nas partes entregues; `related_files` com os arquivos reais; `has_canonical_test: true` apontando para os testes das Tasks 9, 13 e 21)
- `ontology/_index.json`, `ontology/_coverage.json`
- `ontology/_inbox/sispag-boleto-agrupado-hml-achados.md` (estado final), `ontology/_inbox/_watchlist.md`
- `CLAUDE.md` (gotcha do boleto agrupado: tirar o `planned`, citar o campo do marcador e a regra "nunca finalizamos o borderô")
- `DEPLOY.md` (nada de env nova; nota de que o merge ativa o fluxo sob `sispagLiveWriteEnabled`)

**Acceptance criteria:**
- [ ] Ontologia aponta para arquivos reais; nenhum `planned` restante nas partes entregues; V4/V6/caso 2 seguem no watchlist
- [ ] ObservabilityAdvisor consultado: logs estruturados por etapa da execução do borderô, alerta para `indeterminado`/`limpeza_pendente`/`REJEITADO`, métrica de grupos pagos × divergentes
- [ ] Nenhum handler Lambda novo (Express hoje); nada em `jobs/` além dos jobs de verificação; nada no `bootstrapAppContainer` (teste estático: grep de `BorderoGrupoBoletoService`/`GrupoBoletoService` fora de `routes/`, `service/` e testes falha)

**Dependencies:** Tasks 1–22

---

### Task 24: Rollout e acompanhamento pós-merge (não-código, watchlist)
**Files to change:**
- `ontology/_inbox/sispag-boleto-agrupado-rollout.md` (novo, roteiro)

**Acceptance criteria:**
- [ ] Roteiro com o maintainer: primeiro grupo real escolhido de propósito (PEDRONI ou o próximo da medição), conferido no `fin010`, no item do lote, no `.REM` (um J) e no retorno
- [ ] GT3 / V6: primeiro `.RET` real com item de borderô lido (só leitura) e registrado; divergência vira `/investigate`
- [ ] Contagens da primeira semana (grupos confirmados, pagos, retirados, rejeitados, alertas) comparadas com a medição da Task 22
- [ ] V1 conferido pelo maintainer (não portão)

**Dependencies:** merge (depois da Task 25)

---

### Task 25: Gates finais — PatternGuardian, Regis-Review, rebase, versão e PR
**Files to change:**
- `ontology/_inbox/sispag-boleto-agrupado-regis-followups.md` (P1/P2/P3)
- `src/backend/package.json`, `src/frontend/package.json`, `CHANGELOG.md` (bump lockstep; texto da analista do ADR-0076, seção "CHANGELOG (app)")

**Acceptance criteria:**
- [ ] PatternGuardian sem P0 no delta backend (DDD, tsyringe, SQL parametrizado, Zod nos boundaries, arrow methods, `EnvironmentProvider`)
- [ ] Regis-Review (risco: fault-tolerance, integrability, security, testability, availability no mínimo); P0 remediados no mesmo worktree (re-loop sem novo Regis-Review); P1/P2/P3 no arquivo de follow-ups
- [ ] Rebase de `main`; reconferir contra `origin/main` e branches abertas: migration **0089**, **ADR-0076**, ontologia **0.47.0** (0.46.0/ADR-0075 reservados por `docs/sispag-situacao-pagamento-ontology`) e a versão do app; renumerar tudo se colidir
- [ ] Bump minor (`feat`) FE == BE via `scripts/bump-version.ps1 -Execute`, ou à mão nos dois `package.json` se continuar sem `pwsh` (como no ciclo anterior); commit `chore(release): vX.Y.Z`
- [ ] PR com o resumo, os resultados das Tasks 21 e 22 e o aviso de que o merge ativa o fluxo em PRD

**Dependencies:** Tasks 1–23

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend e frontend)
- [ ] `npm run lint` ✅ (backend e frontend)
- [ ] `npm test` ✅ (backend e frontend, incluindo integração da migration 0089)
- [ ] PatternGuardian gate ✅
- [ ] ontology diff presente (v0.47.0, ADR-0076) e `implementation_status` atualizado ✅
- [ ] DesignSystemReviewer gate ✅ (Task 20)
- [ ] ObservabilityAdvisor review ✅ (Task 23)
- [ ] Prova HML ponta a ponta (Task 21) e medição PRD só leitura GT1/GT2 (Task 22) antes do merge ✅
- [ ] Teste estático: nenhuma chamada a `finalizarBordero`/`cancelarBordero`/`fin146` no caminho do grupo ✅
- [ ] Regis-Review gate ✅
- [ ] Rebase de `main`; numeração reconferida ✅
- [ ] App version bumped (FE+BE lockstep, minor) + `CHANGELOG.md` ✅

## Questions / gaps

> **Respostas do maintainer (2026-10-20):**
> - **G1 — fechado com o default:** a sugestão usa o `valor` local (zero chamada ao Conexos); a **confirmação** lê o `fin064` ao vivo dos N títulos (só leitura, fora da transação) e grava o snapshot líquido; a remessa relê de novo (I19b). A GT2 mede a divergência.
> - **G3 — fechado com o default:** `cancelarLote` sempre cancela local; a limpeza do borderô roda **depois do commit**, sob o kill-switch; falha ⇒ `Alerta` `sispag-bordero-grupo-pendente` e o borderô fica para a analista.
> - **Escritas em HML (Tasks 1 e 21):** autorizadas sem pedir a cada rodada. **PRD continua só leitura**; qualquer escrita em PRD para e pergunta.


| # | Prioridade | Gap | Onde bate | Default proposto (não aplicado sem resposta) |
|---|---|---|---|---|
| **G1** | **P1** | **De onde vem o "líquido" na sugestão e na confirmação.** A I19b exige a régua líquida da I17b (`fin064.totalLiquido` conferido), mas a carteira local guarda só `valor = titMnyValor` (base, `ConexosSispagClient.ts:403`). A ação `sugerirGruposBoleto` diz "zero chamada ao Conexos", e a `confirmarGrupoBoleto` diz "reavaliadas ao vivo-local". Com juros/desconto no título, a sugestão local pode mostrar um grupo que a régua líquida recusa (ou esconder um que ela aceitaria). | Tasks 3, 9, 22 | Sugestão usa o `valor` local (sem Conexos, como a ação diz) e marca o grupo como "a conferir"; a **confirmação** lê o `fin064` ao vivo dos N títulos (só leitura, fora da transação), aplica a régua e grava o snapshot líquido; a remessa relê de novo (I19b). A GT2 da Task 22 mede o tamanho do problema. Confirmar com o maintainer que "ao vivo-local" admite essa leitura no `confirmar`. |
| **G2** | **P1** (vira **P0** se a Task 1 não achar campo) | **Campo do marcador no `fin010`.** A I19s reconhece o borderô "pelo marcador quando a resposta se perdeu", mas o nome do campo de observação é "a medir no HML" e nada garante que ele seja **filtrável** no `fin010/list`. Sem filtro, a busca teria de varrer os borderôs da filial. | Tasks 1, 7, 13, 14 | Medir na Task 1. Se houver campo gravável e legível mas não filtrável: busca limitada aos borderôs em cadastro da filial com `borDtaMvto = dataDebito` e `gerNum` do lote, conferindo o marcador na linha (decisão de implementação, sem mudar regra). Se não houver campo nenhum: parar e voltar ao OntologyCurator (a I19s precisa de outra impressão digital). |
| **G3** | **P1** | **Disparo L5 da limpeza (lote local cancelado com rascunho nativo aberto).** A I19q lista esse disparo, mas `LotePagamentoService.cancelarLote` é só local hoje (I1); a limpeza escreve no ERP fora do L8 e a ontologia não diz o que acontece com o cancelamento se a limpeza falhar. | Task 11 | Cancela o lote local sempre; a limpeza roda **depois do commit**, sob o kill-switch, com a sessão de quem cancelou; falha ⇒ `Alerta` `sispag-bordero-grupo-pendente` e o borderô fica para a analista. Alternativa: recusar o cancelamento até a limpeza passar. Decisão do maintainer. |
| **G4** | **P1** | **Formato da linha de retorno do item de borderô.** Os dois casadores de retorno descartam linha sem `docCod` (`ConciliacaoRetornoService.ts:302`, `SincronizacaoLoteService.ts:490`). O HML provou o processamento (gar 7), mas não leu a linha de detalhe: não se sabe se o ERP devolve uma linha (o J, com `borCod`/`itsCodSeq`) ou uma por baixa (com `docCod`). | Tasks 1, 18 | Medir na Task 1 (só leitura da gar 7). A Task 18 casa pela chave nativa nos dois casos; o teste usa o formato medido. |
| **G5** | **P1** | **Numeração.** ADR-0075/0.46.0 estão reservados pela branch não mergeada `docs/sispag-situacao-pagamento-ontology`; a 0089 e a versão do app (0.72.0 prevista) podem colidir com outra branch até o ship. | Tasks 6, 25 | Reconferir em `origin/main` e nas branches abertas antes do commit da 0089 e de novo no rebase final. |

Nenhum gap bloqueia o início: Fase A inteira e as Tasks 6, 8, 10, 12 podem andar já. G1 bloqueia o fechamento da Task 9; G2 o da Task 7/14; G3 o de um critério da Task 11; G4 o da Task 18.
