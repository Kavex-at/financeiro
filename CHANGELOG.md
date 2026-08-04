# Columbia Financeiro — Changelog

## v0.19.0 (2026-07-30) — Frente IV: extrato REAL (Conexos fin095) + processos reais (imp021)

- **feat(recebimentos):** **Módulo 1 implementado** — a carteira de créditos deixa de ser fixture. O
  extrato bancário vem do **Conexos** (`fin133` contas → `fin095` lançamentos), **não da Nexxera direto**:
  supersede a **D4 do ADR-0022** e **ENCERRA o spike O7**, que bloqueava a Fase 1 (ADR-0023). Novo
  `ConexosExtratoClient` (READ-only, Zod no boundary, `onCapHit` → `ExtratoTruncadoError`) e
  `IngestaoTransacoesService` real: advisory lock tomado **uma vez no topo**, fan-out **achatado**
  (filial × conta) num único `BoundedConcurrency`, janela fatiada em blocos de 30d, run de auditoria
  (`recebimento_ingestao_run`, migration 0040) com status **`partial`** quando alguma conta falha.
  Job `job:ingest-extratos` + rotas `POST /recebimentos/ingestao` (409 no lock, `Idempotency-Key`) e
  `GET /recebimentos/ingestao/runs`. Medido em produção: **1.759 créditos** na filial 1 em 90 dias,
  7 contas com movimento, reingestão **100% deduplicada**.
- **fix(recebimentos):** `TransacaoRepository` ganha `upsertMany` com guard
  `WHERE status = 'importada'`. O `save` unitário fazia `status = EXCLUDED.status`, então **a reingestão
  diária devolvia para `importada` qualquer transação que o analista já tivesse movido** para
  `conciliada`/`parcial`/`manual` — perda silenciosa de trabalho. `id` e `correlationId` passam a ser
  **determinísticos** (derivados da `naturalKey`), corrigindo o id-fantasma que o `ON CONFLICT` deixava.
- **feat(recebimentos):** `ProcessoProviderConexos` substitui o stub de 4 fixtures — `imp021` filtrado por
  **`pesCod`** + lista de clientes com processo aberto (cache TTL 10 min). Novo `GET /recebimentos/clientes`.
- **feat(recebimentos):** painel lê do **banco**. `GET /recebimentos/painel` reescrito com authz por-filial,
  KPIs vindos de `COUNT(*) GROUP BY status` (**não** da página, que mentiria com o cap de 500),
  `ultimaIngestao` (só runs `success`) e flag `truncado`.
- **fix(recebimentos):** o frontend **perde os três fallbacks silenciosos de fixture**. O pior deles montava
  um payload de SN **no navegador** quando o backend caía e mostrava toast verde de sucesso — um documento
  que o backend nunca teria gerado. Erro agora é erro.
- **feat(ui):** novo átomo **`Combobox`** (single-select com busca; o `Select` do Radix não tem busca). O
  modal "Alocar" passa a exigir a escolha do **cliente**: o extrato não traz `pesCod` nem CNPJ, e o
  histórico vem **truncado pelo banco** (~21 chars de média — `"TED 001.3344.MC Q I E E"`). O sistema
  pré-seleciona por prefixo, **visível e trocável**; quem confirma é o analista (invariante *match incerto
  nunca auto-baixa*, ADR-0022).
- **fix(ui):** `DialogContent` ganha `max-h-[85vh]` + corpo rolável — nenhum diálogo do app passa mais da
  viewport (antes, uma lista longa empurrava os controles para fora da tela). No modal "Alocar", o seletor
  de cliente fica fixo e só a tabela rola, com cabeçalho sticky.
- **fix(ui):** o payload técnico da SN nasce **fechado**, com resumo legível e um aviso explícito de que
  **ainda não é um documento válido** (`gcdCod` placeholder, moeda assumida, percentual da encomenda
  indefinido). Antes o JSON abria por padrão e o `"gcdCod": 0` parecia um dado normal.
- **chore:** ruído de tesouraria (RESGATE DE APLICAÇÃO, AÇÕES, TRANSFERÊNCIA ENTRE CONTAS — ~15% dos
  créditos) é **escondido na exibição, nunca descartado na ingestão**. O extrato é fonte da verdade.
- **NENHUMA escrita no ERP.** `enviarAoErp` segue lançando `NotImplementedError`; os 8 cards
  *must-fix-before-wire-real* do Regis continuam valendo. Ontologia em **v0.12.0**.

## v0.18.0 (2026-07-29) — Frente IV (Recebimentos + NDe): scaffold + painel + Solicitação de Numerário (dry-run)

- **feat(recebimentos):** ação **`gerarSolicitacaoNumerario` (SN)** — no painel `/recebimentos`, o botão
  **"Alocar"** de uma `TransacaoBancaria` abre um modal com os **processos** candidatos; **"Processar"**
  monta a **Solicitação de Numerário (encomenda)** via com299 `gerDocProcesso`. **DRY-RUN-only:** apenas
  CONSTRÓI e devolve o payload (`dryRun:true`) — **nenhum caminho de escrita ao Conexos é alcançável** (o
  seam `enviarAoErp` lança `NotImplementedError`; `gcdCod=0` placeholder). Processos candidatos vêm de um
  **stub in-memory** atrás de um port/DI token (`PROCESSO_PROVIDER_TOKEN`), swappable por Conexos/matching.
  Rota write-ish com `requireRole('admin')` + `heavyRouteLimiter` + authz por-filial. Regra de
  **percentuais da encomenda** permanece **NÃO-RESOLVIDA** (`TODO(encomenda-percentuais)`, usa valor cru).
- **feat(recebimentos):** Frente IV **frontend Phase 1** — read shell do painel `/recebimentos` (7 KPIs,
  tabs, tabela de transações, chips de status, aba NDe) contra fixtures, espelhando o painel SISPAG.
- **feat(recebimentos):** Frente IV **base scaffold** (contracts-first, stubbed) — ports + DI tokens +
  coordinator + write-ahead ledger + migrations, com remediação do Regis-Review.
- **docs(ontology):** bootstrap da Frente IV — Conciliação de Recebimentos + NDe (ADR-0022); nova ação
  `gerar-solicitacao-numerario.md` + integração `conexos-com299-gerdoc.md`.
- **Regis-Review gate** (`2026-07-29-0243-recebimentos-sn`): 8/8 QAs verdes, score 7.8/10, **zero P0**.
  Backlog de 47 follow-ups (14 P1 · 24 P2 · 9 P3) em `ontology/_inbox/recebimentos-alocar-sn-regis-followups.md`,
  incluindo o bloco **must-fix-before-wire-real** que trava qualquer PR que remova o `NotImplementedError`.

## v0.17.6 (2026-07-18) — SISPAG: paginação na aba de retorno (.RET)

- **fix(sispag):** a aba **"Retorno Lote (RET) - Conexos"** agora tem paginação + filtro (filial e busca
  por banco/config/arquivo), igual às demais abas do painel — reusa o mesmo kit `useTabelaFiltro` /
  `FiltroBarra` / `Paginacao`. Antes a lista de `.RET` renderizava todos os arquivos numa tabela única sem
  paginação. Continua **read-only** e lido **ao vivo** do fin052 (mesmo padrão do REM; nada é gravado no banco).

## v0.17.5 (2026-07-18) — SISPAG: aba de retorno (.RET) + formas de pagamento do cadastro

- **feat(sispag):** nova aba **"Retorno Lote (RET) - Conexos"** (read-only) — lê ao vivo os arquivos de
  retorno (`.RET`) do fin052 (banco/config, status, rejeitados/erros). Subir/processar o `.RET` é fase
  futura (botão desabilitado, em validação com a analista). A aba de lotes nativos vira
  **"Lançamento Lote (REM) - Conexos"** (com botão futuro "Lançar remessa").
- **feat(sispag) — modalidade por formas cadastradas (A2 opção B):** ao revisar um lote, o seletor de
  forma de pagamento agora só oferece as formas que o **favorecido tem cadastradas** no Conexos (lidas
  ao vivo do fin064: barras→boleto, chave PIX→pix, banco+conta→ted/crédito). Evita finalizar um lote e
  gerar `.REM` com forma sem cadastro (→ rejeição no banco). Avisa "sem forma cadastrada" / "forma não
  cadastrada". READ-only no ERP (I1).

## v0.17.4 (2026-07-18) — SISPAG navegável em produção + decisões do analista

- **feat(sispag):** SISPAG **desbloqueado em produção** (`SISPAG_ENABLED=true` no backend +
  `NEXT_PUBLIC_SISPAG_ENABLED=true` no frontend) — painel/ingestão/formação/revisão de lotes navegáveis.
  A geração de remessa (fin015) e o retorno (fin052) seguem **dormentes/gated** (ainda não executam lotes).
- **feat(sispag) A4 — internacional fora do escopo:** pagamento ao exterior é câmbio manual da tesouraria
  (Itaú→BB), não passa pelo SISPAG. Removida a divisão nacional×internacional de ponta a ponta (ingestão
  nem persiste, some do painel) e o invariante I7. Migration `0030` purga o legado e dropa as colunas.
  **Requer re-ingestão após deploy.**
- **feat(sispag) A3 — conta pagadora por lote:** default **Itaú** (55795-4); o analista troca na revisão
  (exceção rara: fornecedor que não aceita boleto via Itaú). Seletor no card do lote.
- **feat(sispag) A2 — forma de pagamento por título:** modalidade (boleto/TED/PIX/crédito em conta) por
  item, com **revisão obrigatória**. **Boleto auto-detectado** por código de barras (classificação persistida
  na ingestão, migration `0031`); título sem forma definida **bloqueia a finalização**. A5 sem mudança.
- **fix(sispag):** read-path do `ConexosSispagClient` endurecido — fallback sem filtro só em HTTP 400
  (não mascara 5xx/timeout) + `runWithRetry` nos 6 reads (paridade). I1 (read-only) preservada.
- **feat(sispag) — ferramentas Fatia 3 (dormentes):** caixa de ferramentas de escrita `fin015`
  (`ConexosSispagWriteClient`) e de retorno `fin052` (`ConexosSispagRetornoClient` + infra de upload
  multipart), validadas em HML, sem caller de produção. Ver `ontology/_inbox/sispag-fin0*-exploration.md`.

## v0.17.3 (2026-07-17) — Fix: surface do motivo real dos erros do ERP (caixa-preta)

- **fix(permutas):** os erros do `fin010` que voltam no envelope genérico `Generic.ERROR_MESSAGE` passam a
  mostrar a **razão real** (escondida em `vars.msg`, ex.: "CONTA DE DESCONTO NÃO INFORMADA!!!") em vez do
  texto genérico "estado incompatível com a ação". Novo `ErpErrorInterpreter` como fonte única de tradução
  (unifica os dois mapas PT antes divergentes) usado nos 3 caminhos: ações do borderô
  (Aprovar/Cancelar/Excluir), erro de baixa (`erroMensagem` no painel) e os passos de validação do
  handshake. Toast das ações limpa o prefixo redundante "API 400 —". Puro surfacing/observabilidade — sem
  mudança no comportamento de escrita no ERP. Ver `integrations/conexos.md` (contrato de leitura de erro).

## v0.17.2 (2026-07-17) — Fix: resíduo de centavos no adiantamento na baixa/permuta

- **fix(permutas):** a baixa/permuta que consome o adiantamento por inteiro passa a fechar o líquido
  no valor REAL do adto no ERP (`bxaMnyValorPermuta`), eliminando o resíduo de centavos "à permutar"
  que sobrava quando a variação cambial era reconstruída por `USD × taxa` (taxa arredondada a 3 casas).
  A diferença é absorvida na conta de variação já em uso (131 juros / 130 desconto). Teto absoluto de
  R$1,00 no resíduo absorvido (não escala com o valor) para nunca mascarar um saldo real; resíduo maior
  fica para conferência manual (log). Só para invoice de título único em full-consume — perna parcial
  (N:M) segue rateando por taxa. Novo invariante **I-Write-6** (ver ADR-0020).

## v0.17.1 (2026-07-11) — Filtro de período nos borderôs de permuta

- **feat(permutas):** o filtro de **Data** do painel de borderôs vira um **intervalo** (Data inicial
  / Data final) para filtrar um período. O intervalo é inclusivo e cada ponta é opcional (só início =
  "a partir de", só fim = "até"). Puramente client-side — sem mudança de backend/migration.

## v0.17.0 (2026-07-10) — Identidade por usuário @kavex + fix do painel de borderôs

- **refactor(usuarios):** o gerenciamento de usuários passa a ser um recurso de **root da
  plataforma** — card "Usuários" na home (só admin), no lugar do link no header (que aparecia em
  todos os produtos). Desacopla a administração de qualquer produto específico.
- **ci(sispag):** agenda a **ingestão diária + formação de lotes** do SISPAG (GitHub Actions,
  `ingest-sispag.yml`): 1x/dia às 10:00 UTC (07:00 BRT), +1h após a ingestão matinal de Permutas
  para não conflitar na sessão Conexos. Os jobs usam o robô e não são afetados pelo bloqueio de
  acesso do SISPAG.
- **feat(sispag):** **bloqueio do SISPAG em produção**. Flag `SISPAG_ENABLED` (backend) /
  `NEXT_PUBLIC_SISPAG_ENABLED` (frontend): quando desligada, as rotas `/sispag/*` respondem 403
  (bloqueio via URL, não só no front) e a UI mostra o card "Indisponível" (inclicável) + tela de
  bloqueio na rota. Sem a env, fica habilitado só em dev local e **bloqueado em qualquer build
  deployado** (fail-safe). Não afeta Permutas.

- **feat(auth):** identidade por usuário @kavex. Nova tela **Usuários** (só admin) que substitui o
  cadastro manual no banco: criar/desativar usuários, redefinir senha e **atrelar o acesso Conexos**
  de cada um (login + senha do ERP). A senha do Conexos é guardada **cifrada** (AES-256-GCM,
  `SecretCipher` + env `CONEXOS_CRED_ENC_KEY`) — nunca em claro. Migrations `0028` (`ativo`,
  `created_by`) e `0029` (`conexos_username`, `conexos_password_enc`).
- **feat(auth):** **sessão Conexos por usuário**. Quando um usuário logado tem vínculo válido, as
  chamadas ao ERP naquela request usam a sessão dele (a baixa sai no nome dele); jobs/crons e o
  fallback usam o robô. `ConexosService` virou instanciável (credenciais + store por instância),
  `conexos_sessions` virou multi-chave (`columbia:user:<login>`), e um `AsyncLocalStorage` +
  `ConexosSessionResolver` decidem a sessão por request no adapter — sub-clients não mudaram.
  Fallback seguro: sem vínculo / senha não decifra / login falha → robô. Aviso persistente no
  login (`GET /me/conexos-status` + banner) quando a credencial falha e o usuário opera via robô.
- **fix(permutas):** borderôs criados pela plataforma sumiam do painel ao envelhecerem para fora
  dos 500 mais recentes (a busca e o filtro de usuário eram client-side sobre essa janela).
  `listBorderoCache` agora faz **UNION** dos recentes com **todos os borderôs da trilha**, que
  passam a ser sempre visíveis (com o email do operador).

## v0.16.4 (2026-07-09) — SISPAG: remove a aba Borderôs

- **refactor(sispag):** removida a aba **Borderôs** do painel (era diagnóstico e mostrava o pool
  a-pagar inteiro, incluindo permutas). Com ela, saiu também o **fetch ao vivo de borderôs** no
  `SispagPainelService` (fan-out Conexos que não tinha mais consumidor) e os KPIs
  `borderosViaRemessa`/`borderosTotalAmostra`. O painel agora só faz 1 leitura ao vivo por filial
  (lotes nativos). `ConexosSispagClient.listBorderosAPagar` fica como capacidade read-only (sem uso).

## v0.16.3 (2026-07-08) — SISPAG: Lote automático "adotado" ao ser editado

- **fix(sispag):** quando o analista **mexe num lote automático** (adiciona **ou** remove título),
  o lote **vira manual** (`automatico=false`) e o **cron para de gerenciá-lo**. Evita o efeito
  colateral de o cron **desfazer** um lote automático (regra desfaz-vencidos) depois que o analista
  o curou — ex.: ao adicionar um título vencido. `LotePagamentoService.incluirTitulo`/`removerTitulo`
  chamam `marcarManual` quando o lote era automático.

## v0.16.2 (2026-07-08) — SISPAG: Incrementar lote (adicionar títulos)

- **feat(sispag):** o analista agora pode **adicionar títulos** a um lote RASCUNHO (não só
  remover). Botão **"Adicionar título"** no card do lote abre um modal com os títulos elegíveis
  (mesma filial + mesma classe nacional/internacional, aprovados, ainda sem lote), com busca e
  seleção múltipla. Usa o `incluirTitulo` já existente (invariantes I2/I3/I4/I7 no backend).

## v0.16.1 (2026-07-08) — SISPAG: UX dos lotes + trava anti-reatache

- **fix(sispag):** cards de lote agora são **colapsáveis** (só o resumo por padrão; os títulos
  expandem sob demanda) e a paginação dos lotes caiu para **8/página** — a tela de lotes deixou
  de ficar gigante e difícil de navegar.
- **fix(sispag):** o botão **"Formar lotes automáticos"** saiu da aba "Lotes candidatos" e agora
  aparece só na aba **"Títulos a pagar"** (onde faz sentido montar).
- **feat(sispag):** títulos **já num lote RASCUNHO** aparecem com a flag **"em lote"** e o
  **checkbox desabilitado** — não podem ser atachados a outro lote (I3, anti-reatache). O painel
  passa a marcar `emLote` lendo os itens dos lotes RASCUNHO.

## v0.16.0 (2026-07-08) — SISPAG: Ciclo pós-finalização (aba Finalizados + status RETORNADO) + paginação/filtros nos lotes

- **feat(sispag):** o ciclo do lote ganha a fase pós-finalização. Novo status **RETORNADO**
  ("de volta do Nexxera"): `RASCUNHO → FINALIZADO (aguardando retorno) → RETORNADO`.
  - Ao **finalizar**, o lote **sai** de "Lotes candidatos" e vai para a nova aba **"Finalizados"**
    (mostra "finalizado por X" + "aguardando retorno do Nexxera"). Quando o retorno chega, vira
    **"de volta do Nexxera"** (RETORNADO). Migration `0027` (CHECK + status). Transição
    `marcarRetorno` (FINALIZADO→RETORNADO) via `POST /sispag/lotes/:id/retorno` — hoje manual
    (botão "Marcar retorno recebido"); o gatilho real é o robô-poller (Fatia 3).
  - **Paginação + filtros** nas duas abas de lotes (candidatos e finalizados): filial, busca,
    nacional × internacional, e status (aguardando / de volta) — mesmo kit de Permutas.
  - Card de lote extraído em componente reutilizável (`LoteCard`).
  - **Verificado:** 0 lotes duplicados (nenhum título em 2+ lotes RASCUNHO — anti-join OK).
  - Ontologia (state-machine lote-pagamento + status RETORNADO).

## v0.15.0 (2026-07-08) — SISPAG: Formação automática de lotes (cron pós-ingestão)

- **feat(sispag):** um cron novo (`job:formar-lotes`, roda logo após a ingestão) + endpoint
  manual (`POST /sispag/lotes/formar`) que **monta lotes candidatos automaticamente** a partir
  da carteira persistida — o analista revisa (add/remove) antes de aprovar.
  - **Regras** (as mesmas da montagem manual): mesma filial (I4), mesma classe nacional/
    internacional (I7), e **só títulos A VENCER** (≤7 dias — vencidos NÃO entram).
    **Agrupamento** por filial × classe × banco.
  - **Desfaz-vencidos:** a cada run, lotes automáticos ainda em RASCUNHO que já contêm título
    vencido são **desfeitos** (títulos liberados) — só a vencer é elegível. O cron **nunca** mexe
    em lotes manuais nem finalizados.
  - **Anti-duplicação:** só forma lote com títulos que ainda não estão em nenhum RASCUNHO (anti-join).
  - Lotes automáticos nascem **RASCUNHO** e aparecem em **"Lotes candidatos"** com badge
    "automático". Migration `0026` (`lote_pagamento.automatico`). Ontologia v0.8 (ADR-0018).
  - **Caveat:** hoje `banco` vem nulo nos títulos a-pagar (fin064 não o traz antes do pagamento),
    então o agrupamento por banco degenera para filial × classe. Follow-up quando houver fonte de banco/conta.
  - Verificado ao vivo: 9 lotes automáticos / 699 títulos.

## v0.14.0 (2026-07-08) — SISPAG: Nacional × Internacional (filtro + lote uniforme)

- **feat(sispag):** classificação **Nacional × Internacional** dos títulos a pagar e a regra de
  negócio **I7 — lote uniforme** (um lote é 100% nacional **ou** 100% internacional, nunca misto;
  rails de pagamento distintos: boleto/PIX nacional vs. câmbio/exterior).
  - **Discriminador:** `ufEspSigla` no Conexos `com298` — `'EX'` = exterior (internacional); UF BR =
    nacional. O `fin064` (fonte dos títulos) **não** traz `ufEspSigla`, então a classe é enriquecida
    via `com298` (`ConexosSispagClient.isDocInternacional` / `listExteriorDocCods` — READ-only).
  - **Ingestão** enriquece cada título com `internacional` e **persiste** (`titulo_a_pagar`, migration
    `0025`) para o filtro do painel.
  - **Invariante I7** autoritativo no `LotePagamentoService.incluirTitulo` (classe via com298;
    1º item define a classe do lote, os seguintes têm de bater) → erro `LoteTipoConflitoError` (422).
    Também bloqueado no front na hora de "Criar lote".
  - **Frontend:** segmento de filtro **Todas / Nacionais / Internacionais** + badge "internacional"
    nos títulos + bloqueio de seleção mista.
  - Ontologia v0.7 (business-rule `lote-uniforme-nacional-internacional` + ADR-0017).

## v0.13.0 (2026-07-08) — SISPAG: Ingestão de pagamentos (carteira persistida + cadência diária)

- **feat(sispag):** a carteira de **títulos a pagar** deixa de ser lida ao vivo e passa a ser
  **persistida** (`titulo_a_pagar`, migration `0024`), com **cadência diária** — espelha o modelo de
  Permutas. Read-only ao ERP (I1); a única escrita é o Postgres próprio.
  - **Ingestão** (`IngestaoPagamentosService`): lê os títulos do Conexos (janela −15d/+45d, fan-out
    limitado via `BoundedConcurrency`) e faz **UPSERT** por chave natural. Grava um **run de auditoria**
    (`pagamento_ingestao_run`: quem/quando/status/contagens). Exclusão cross-processo por **advisory
    lock** (`IngestLockBusyError` → 409) + **idempotência** (`Idempotency-Key`).
  - **Gatilhos:** cron `job:ingest-pagamentos` (diário) + manual `POST /sispag/ingestao`; auditoria em
    `GET /sispag/ingestao/runs`.
  - **Anti-fantasma (`ativo`):** títulos que somem da run são inativados — mas **só nas filiais lidas
    com sucesso** (uma filial que falha na leitura NÃO perde seus títulos por engano — fault-tolerance).
  - **`pronto_para_remessa`** (heurística informativa): marca no painel "pode faltar cadastro"
    (banco/conta/modalidade); a validação **autoritativa** é no envio (Fatia 3, ao vivo — anti-drift).
  - **Painel** passa a **ler do banco** (snapshot rápido + idade da carteira); lotes nativos/borderôs
    seguem ao vivo. Frontend: botão **"Ingerir agora"**, idade dos dados, badge de cadastro faltante.
  - Ontologia v0.6 (`titulo-a-pagar` persistida + ação `ingerir-pagamentos` + ADR-0016). Regis quick
    (PatternGuardian + fault-tolerance): zero P0; P1 (partial-read) remediado. Follow-ups no inbox.

## v0.12.0 (2026-07-07) — SISPAG (Escopo II): Painel de pagamentos + Montagem de lote + Gate (Fatia 1+2)

- **feat(sispag):** primeira frente do **Escopo II (Automação de Pagamentos)** — **read-only ao ERP**
  (nenhuma escrita no Conexos, invariante I1). Ver ADR-0015 e `ontology/entities/lote-pagamento.md`.
  - **Painel diário** (`GET /sispag/painel`): títulos a pagar aprovados (janela −15d/+45d), lotes SISPAG
    nativos (`fin015`), borderôs a-pagar (`fin010`) + KPIs. Fan-out Conexos **limitado** via
    `BoundedConcurrency` (evita o burst que pressiona o pool de sessões).
  - **Montagem assistida do lote candidato** (agregado LOCAL `lote_pagamento`/`lote_pagamento_item`,
    migration `0023`): criar / incluir / remover título / **finalizar (gate)** / reabrir / cancelar.
    Máquina de estados `RASCUNHO → FINALIZADO → CANCELADO`.
  - **Invariantes na fronteira do agregado:** I2 (só título aprovado+não-pago, re-leitura autoritativa
    do Conexos com snapshot anti-drift), I3 (não-duplicação via advisory-lock + transação), I4 (uma
    filial por lote), I5 (gate + auditoria), I6 (optimistic lock por `versao`).
  - **Frontend** (`/sispag`): painel + abas Títulos / Lotes candidatos / Lotes nativos / Borderôs;
    seleção → criar lote → finalizar/reabrir/cancelar. Banner "montagem local — sem escrita no ERP".
  - **Fora de escopo (próxima fatia):** gerar remessa (`fin015` write), pasta de rede + Nexxera/VAN,
    retorno (`fin052`), baixa (`fin010` write), scheduler. Diagnóstico em `ontology/_inbox/sispag-*.md`.
  - Regis-Review completo (8 QA): overall 6.47/10, **zero P0 residual** (3 P0 remediados: cobertura de
    testes, `BoundedConcurrency` no fan-out, bump de versão). P1/P2/P3 → `sispag-painel-montagem-regis-followups.md`.

## v0.11.0 (2026-06-29) — Sessão Conexos compartilhada (1 SID no Postgres) — fim do MAX_SESSIONS

- **feat(conexos):** o **SID da sessão Conexos** passa a ser **compartilhado entre todos os processos**
  via uma linha única na tabela `conexos_sessions` (migration `0022`). Antes, cada processo (Render,
  dev server, scripts) fazia seu próprio `POST /login`, brigando pelos ~3 slots de `MAX_SESSIONS` da
  conta Conexos e disparando kill-oldest em cascata.
  - **Como funciona:** antes de logar, o `ConexosService` **adota** um SID válido já existente no store
    (sem novo `POST /login`); após um login fresco, **publica** o SID com **concorrência otimista**
    (coluna `version` — INSERT-on-absent / UPDATE-if-unchanged). O perdedor de uma corrida adota o SID
    do vencedor. Em 401, invalida condicionalmente (só se a linha ainda contém o SID morto) e reloga.
  - **Segurança:** `conexos_sessions` com **RLS habilitada e sem policies** — só a conexão direta do
    backend (dona da tabela) lê/escreve; anon/PostgREST nunca leem o SID (credencial viva do ERP).
  - **Degradação graciosa:** sem `databaseConnectionString` (dev local sem banco) o store **desliga** e
    cada processo loga sozinho (comportamento anterior). Qualquer erro de banco vira "miss" — **nunca**
    derruba a integração com o Conexos. Implementação portada do `fechamento-processos` (Task 10/CC-3),
    usando `pg` (mesma conexão do projeto), sem dependência/variável de ambiente nova.

## v0.10.0 (2026-06-29) — Sessão expirada: modal bloqueante de relogin + write irreversível single-attempt

- **feat(auth):** quando o **JWT de login (12h) expira**, abre um **modal bloqueante** "Sua sessão
  expirou" (não-dismissável) mostrando o **horário exato** da expiração e deixando claro que **nada
  feito após esse horário foi salvo** — botão "Entrar novamente" faz `signOut` e vai para
  `/login?returnTo=…` (volta para a mesma página após logar). Antes, o token expirado virava "sessão
  zumbi" (ficava no `localStorage`) e toda ação falhava com um `toast` genérico "API 401".
  - **Detecção central:** `lib/http.ts` `apiFetch` intercepta **só 401** (demais status, incl. 409/422,
    passam intactos), dispara um bus de módulo (`lib/auth/session-events.ts`) e lança `SessionExpiredError`;
    as ~24 chamadas de `lib/api.ts` passam a usar `apiFetch`.
  - **Proativo + reativo:** o `AuthProvider` agenda o modal no `exp` do token (timer; abre sozinho mesmo
    ocioso) **e** reage a qualquer 401. Catch-sites de mutação ignoram `SessionExpiredError` (o modal cuida).
- **fix(fault-tolerance) [fin010]:** a escrita irreversível `gravarBaixaPermuta` passa a usar um POST de
  **tentativa única** (`authenticatedPostOnce`/`postGenericOnce`, sem re-login/retry em 401) — fecha a
  janela de **baixa dupla** (super-pagamento) que o retry-em-401 do `authenticatedPost` abria; em 401 a
  reconciliação falha **fail-closed** para conferência manual. Demais writes seguem com retry.

## v0.9.2 (2026-06-26) — Permutas: aba Borderôs abre instantânea (stale-while-revalidate)

- **perf(permutas) [Borderôs]:** a aba Borderôs deixava de renderizar **esperando o refresh AO VIVO do
  ERP em todas as filiais** (carga inicial `live=true`). Agora usa **stale-while-revalidate**: mostra o
  **cache na hora** (lê do banco em ms) e revalida o ERP **em background** — chip discreto "atualizando…"
  ao lado do Atualizar; a lista se refresca sozinha quando volta; se o ERP falhar, mantém o cache (sem
  travar). O botão **Atualizar** segue como refresh ao vivo explícito. Mudança contida em `BorderosPanel`.
- **refactor (estrutural, sem mudança de comportamento) — landou junto nesta janela:**
  - **CC-2** (`#24`): o god-client `ConexosClient` (1.972 LOC) foi quebrado em `ConexosBaseClient` +
    `ConexosBaixaClient`/`…FinanceiroClient`/`…TitulosClient`/`…CadastroClient` (por família de endpoint),
    7 call sites migrados, 496 testes verdes. Destrava SISPAG/GED.
  - **CC-1** (`#23`): o god-component `page.tsx` (2.981 → 1.026 LOC) foi quebrado em componentes por aba +
    modais (`next/dynamic`) + hooks; **+14 testes de componente** (antes 0 na tela).

## v0.9.1 (2026-06-26) — Permutas: coluna "Referência Externa" no lugar de "Código" (thread completo)

- **feat(permutas):** nas listas **"Adiantamentos pendentes de permuta"** e **"Invoices em aberto"** do
  painel, a coluna **"Código"** passa a mostrar a **"Referência Externa" do processo (cliente)** —
  Conexos `priEspRefcliente` (ex.: `0052INX/26`), igual para todos os documentos do processo — em vez do
  código interno (docCod). O docCod segue no detalhe expandido (campo "Código").
  - Esse campo **não estava no snapshot** (só era usado como fallback do nº do documento), então foi
    adicionado **fim-a-fim**: `ConexosClient.mapDocPagar` expõe `referenciaExterna`; migration `0021`
    (coluna `referencia_externa` em `permuta_adiantamento`/`permuta_invoice`); ingestão + repositório +
    payload do `/gestao`; e a coluna no front (com fallback pro nº do documento enquanto o re-ingest não
    popula). **Requer rodar a migration + uma ingestão** para preencher (linhas antigas ficam com o
    fallback até lá). As abas de trabalho não mudaram.

## v0.9.0 (2026-06-26) — Permutas: baixa de invoice com MÚLTIPLOS TÍTULOS (parcelas)

- **feat(permutas) [escrita ERP — Opção A]:** a baixa no `fin010` passa a tratar invoices com **N títulos
  (parcelas)**. Antes a baixa era hardcoded em `titCod: 1` → só o 1º título baixava e o anti-drift barrava
  o resto (caso 4120: parcelas 116.159,22 + 1.078,14 = 117.237,36). Agora `executarBaixa` busca os títulos
  (`listTitulosAPagar`) e baixa **cada parcela** (handshake completo por título via `baixarTitulo`) no
  **mesmo borderô**, distribuindo o valor alocado (FIFO por `titCod`); a variação cambial é **rateada** pela
  fração do título; `buildFinalPayload` ganhou o parâmetro `titCod`. Invoice de **título único** (a maioria)
  = loop de 1 → comportamento idêntico. Anti-drift agora é **por título**. Decisão Yuri + HAR de baixa manual
  multi-título. O `reconciliar-lote` herda automaticamente. Resolve a pendência
  `ontology/_inbox/permuta-multi-titulo-pendente.md`. BE 496 verde (teste novo cobrindo 2 títulos).
  - ⚠️ Caminho gated (`CONEXOS_WRITE_ENABLED`/`DRY_RUN`) — validar em homolog/dry-run antes de prod.

## v0.8.5 (2026-06-26) — Permutas: libera "Alocar" para remover alocação de adto totalmente alocado

- **fix(permutas):** o botão **Alocar** (Múltipla/Cross-over/Cross-process) ficava **desabilitado** quando
  o adiantamento estava **totalmente alocado** (saldo restante 0) — mas é dentro do modal de Alocar que se
  **remove** a alocação. Resultado: um adto totalmente alocado **sem borderô ainda** (Pendente) ficava com
  a alocação **presa**, impossível de remover. Agora o Alocar só desabilita quando **não há saldo E não há
  alocação** pra gerenciar; com alocações, ele abre pra você **ver/remover**.

## v0.8.4 (2026-06-26) — Regis-Review quick wins (segurança + performance)

- **fix(security) [R-5 / security-1]:** guard do `DEV_AUTH_BYPASS` vira **deny-by-default**. Antes era uma
  allow-list `['prd','stg','hml']` e o nome `'production'` (que o Render seta) **escapava** — a API
  financeira poderia subir **sem validação de JWT** em produção. Agora o boot **falha** se
  `DEV_AUTH_BYPASS=true` em qualquer ambiente que não seja reconhecidamente local/dev
  (`local`/`dev`/`development`/`test` ou `environment` não setado). `http/authEnv.ts`.
- **perf(permutas) [performance-1]:** `AlocacaoPermutasService.buscarInvoices` passa a **capar a
  concorrência** das chamadas ao Conexos (cada invoice dispara ~3 chamadas) via `BoundedConcurrency`
  (teto 8), em vez de `Promise.all` sem limite — evita estourar o ERP em processos com muitas invoices.
- **perf(permutas) [performance-2]:** auto-alocação em lote (`autoAlocarSeElegivel`) deixa de ser
  **O(N²)** chamadas ao Conexos — a lista de invoices é buscada **uma vez** e reusada por cada `alocar`
  (param `prefetchedInvoices`) em vez de re-buscar LIVE por item. Snapshot consistente + ~N× menos I/O.
- **test(permutas) [testability-2]:** cobre os 14 métodos públicos restantes do `PermutaExecucaoRepository`
  (idempotência da baixa) — cobertura **49% → 96% stmts / 100% lines** (SQL parametrizado, cache de borderô,
  delete/rename de chave). BE 494 testes.
- **fix(permutas) [R-4 / fault-tolerance — anti super-pagamento]:** a baixa no `fin010` deixa de poder
  **re-POSTar** uma execução interrompida no meio do handshake. Se uma execução anterior ficou em
  `reconciling` **com `bor_cod`** (processo morto entre o POST irreversível e o `markSettled`), a baixa
  PODE já estar no ERP → re-tentar seria **dupla baixa**. Agora o par é **abortado** (fail-closed) com
  mensagem pedindo conferência manual do borderô no Conexos, em vez de re-postar. A idempotência viva
  passa a cobrir `reconciling`, não só `settled`. `ReconciliacaoPermutaService`. (Follow-ups do R-4 ainda
  abertos: `Idempotency-Key` HTTP em `/reconciliar`+`/reconciliar-lote` e reaper de execução órfã.)
- **fix(permutas) [crítico — cache de borderô por filial]:** o número do borderô no Conexos é **por
  filial** (cada filial numera o seu). O cache `permuta_bordero` tinha **PK só em `bor_cod`**, então
  borderôs de filiais diferentes com o **mesmo número colidiam** e sumiam da aba Borderôs (ex.: borderô
  1824 existe na filial 1 — do adto 3569 — e na filial 4; o da filial 1 sumia). As faixas se sobrepõem
  muito entre filiais, então a perda era ampla. Correção: **chave composta `(fil_cod, bor_cod)`** —
  migration `0020`, dedup do `refreshCache` por par, `replaceBorderoCache`/`updateBorderoCacheSituacao`/
  `deleteBorderoCache` por `(filial, borderô)`, e a **trava `borderoDoPar` (v0.8.3)** passa a casar
  `permuta_bordero` por **filial + borderô** (corrige bug latente de ler a filial errada). O status do
  painel já estava correto (query ao vivo filtrada por filial). Requer rodar a migration; o cache se
  repovoa no próximo "Atualizar"/ingestão.
- **docs:** relatório completo do **Regis-Review** (8 QAs, Bass & Clements) em
  `docs/regis-review/2026-06-26-0058/` (REPORT.md + KANBAN.md de 66 cards). Overall 5.35; Fault Tolerance 8.1.

## v0.8.3 (2026-06-26) — Permutas: trava ignora borderô CANCELADO

- **fix(permutas):** a trava de remoção de alocação (v0.8.2) passa a **ignorar borderôs CANCELADOS**
  (`permuta_bordero.bor_vld_finalizado = 2`). Cancelar estorna a baixa no ERP → a alocação volta a
  estar livre → não deve mais travar. Antes, depois de cancelar um borderô, a "perna" da permuta ficava
  presa (a trava ainda citava o borderô cancelado). Borderô **em cadastro / finalizado / estornado**
  continua travando (baixa viva); **excluído** já sai da trilha. `PermutaExecucaoRepository.borderoDoPar`
  ganha um `NOT EXISTS` contra o cache de borderô.

## v0.8.2 (2026-06-26) — Permutas: trava remoção de alocação já usada em borderô

- **fix(permutas) [crítico — integridade financeira]:** **bloqueia a remoção** de uma alocação (par
  adto↔invoice) que **já foi usada para abrir um borderô** no ERP. Antes, remover essa alocação fazia o
  **saldo do adiantamento voltar integral** (descasando a trilha do que já foi baixado no `fin010`) e
  abria porta para **dupla baixa**. Agora o backend recusa com **HTTP 409** (`AlocacaoEmBorderoError`) e a
  UI mostra a mensagem citando o borderô. Vale para Múltipla / Cross-over / Cross-process. A trava se
  **desfaz automaticamente ao EXCLUIR o borderô** (o excluir já apaga a trilha de execução via
  `deleteByBorCod`); cancelar/estornar preservam a trilha (o borderô ainda existe), então a trava
  permanece. Novo `PermutaExecucaoRepository.borderoDoPar`.

## v0.8.1 (2026-06-26) — Permutas: baixa parcial nas abas manuais

- **fix(permutas):** nas abas **Múltipla / Cross-over / Cross-process**, uma permuta só sai da aba de
  trabalho para o **Histórico** quando o adiantamento está **totalmente permutado** (`tem borderô` E
  `saldoRestante ≈ 0`). Baixa **parcial** (sobrou saldo a permutar) **continua na aba**; o que foi lançado
  vai para Borderôs + Histórico. Cancelar o borderô faz a permuta reaparecer (igual às automáticas).
- **fix(permutas):** na baixa **parcial**, os botões **Alocar** e **Baixar** continuam liberados para lançar
  o saldo restante (antes travavam ao ter qualquer borderô). O já baixado é ignorado por idempotência. O
  status passa a mostrar **"Parcial · borderô X"** enquanto sobra saldo.
- **chore:** Histórico das manuais mostra o valor **efetivamente lançado** (Σ alocações), não o adiantamento
  inteiro; botões "Atualizar" por aba; auto-reload do status ao trocar de aba.
- **Pendente (documentado):** invoice com **múltiplos títulos/parcelas** (`ontology/_inbox/permuta-multi-titulo-pendente.md`)
  — a baixa hoje assume 1 título por invoice; aguardando definição do time.

## v0.8.0 (2026-06-25) — Permutas: relatórios, execução em lote e fix do filtro de filial

> Consolidação dos PRs #9, #10, #11, #13, #14 e #15 num único release.

- **feat(permutas):** exportação Excel (.xlsx) dos KPIs e relatórios do painel — Adiantamentos,
  Invoices, Já permutado e Bloqueadas no nível de detalhe de cada documento, mais dois relatórios
  analíticos derivados (Reconciliação por processo e Quebra por cliente). Novo endpoint READ-ONLY
  `GET /permutas/relatorios/:tipo` (reusa o snapshot do `/gestao`; serialização via exceljs) e botão
  "Exportar" no header do painel (um arquivo por relatório).
- **feat(permutas):** botão **"Executar"** na aba Automáticas — cria os borderôs das automáticas em
  **lotes de até 10 por clique** (cap server-side; baixa real no `fin010`). Novo endpoint
  `POST /permutas/reconciliar-lote` (admin + heavyRouteLimiter) orquestrando `reconciliarPermuta` adto
  a adto com **continue-on-error**; herda o gate de escrita, a idempotência write-ahead e a atomicidade
  por par. O analista clica de novo até zerar. Diálogo de confirmação. O "Processar" individual continua intacto.
- **fix(permutas):** o seletor "Filial" passa a incluir filiais que só têm invoices (sem adiantamento
  PROFORMA) — ex.: filial 6. Agora a lista é a união das filiais de adiantamentos + invoices.
- **fix(permutas):** baixa de **DESCONTO** grava a **conta de desconto (130 = VAR. CAMBIAL ATIVA)** —
  antes ia `null` e o ERP recusava a finalização do borderô ("CONTA DE DESCONTO NÃO INFORMADA").
- **fix(permutas):** observabilidade das ações de borderô — loga a resposta crua do ERP + devolve
  `requestId` quando o Conexos recusa finalizar/cancelar/estornar/excluir.
- **feat(permutas):** tela de **Borderôs** carrega ao vivo ao entrar (sem clicar em "Atualizar") e
  ordena os EM ABERTO da nossa trilha no topo; o resto (finalizados + ERP) por data.
- **fix(infra):** rate-limiters desligados sob `NODE_ENV=test` (evita 429 espúrios na suíte combinada).
- **feat(permutas):** nova aba **Histórico** (ao lado de Borderôs) — tudo que já foi executado (borderô
  criado) sai das abas de trabalho e cai lá (read-only; aprovar/cancelar é em Borderôs). As abas
  Automáticas/Múltiplas/Cross-over/Cross-process passam a mostrar só o que falta processar/alocar/baixar.
- **chore(permutas):** tamanho do lote do "Executar" reduzido de 10 para **6** por clique (FE + cap backend).

## v0.7.0 (2026-06-24) — Permutas: cliente, universo de invoices, ciclo de borderô e cache

- **feat(permutas):** reclassificação automática — múltiplas onde o adiantamento **cobre todas as
  invoices** do processo (adto ≥ Σ invoices) viram **AUTOMÁTICAS** (casamentos sintéticos pré-distribuídos,
  com "Processar" = baixa real auto-alocada); casamentos simples cujos adtos **ultrapassam** a invoice
  caem para manual (cross-over/múltipla).
- **feat(permutas):** **status PERMUTA→BORDERÔ** por adiantamento (`GET /permutas/status`, lazy) —
  badge Pendente / Aguardando finalização / Finalizado; borderô cancelado/estornado/excluído reabre a
  permuta para novo lançamento.
- **feat(permutas):** **busca por CLIENTE** (importador) em todas as abas + no detalhe; importador
  hidratado (imp021) para **TODAS as invoices** na ingestão.
- **feat(permutas):** ingestão lista **TODAS as invoices finalizadas** (não só as casadas) com valor em
  moeda negociada (com308) — vista "Invoices em aberto" com filtro Todas / Só casadas.
- **feat(permutas):** **aba Borderôs** in-place na Gestão de Permutas + **cache de borderôs**
  (`permuta_bordero`, populado na ingestão; "Atualizar" = refresh ao vivo) — leitura do banco (rápido),
  500 mais recentes, ações atualizam o cache na hora; detalhe (baixas do ERP) de borderôs lançados
  direto no Conexos via expand.
- **feat(ui):** input monetário com máscara pt-BR + botão "Máx"; moedas com alias ISO no KPI;
  paginação (50/pág) e ordenação mais-novo→mais-velho nos borderôs; saída "Liberar" removida.
- **fix(permutas):** remoção do botão Estorno; mensagens de erro do fin010 amigáveis.
- Migrations `0017_invoice_importador`, `0018_permuta_bordero_cache`, `0019_permuta_perf_indexes`.
- **Regis-Review (2026-06-24-2011) — remediação pré-merge dos blockers:**
  - **P0** removido o endpoint `DELETE /borderos/:borCod/trilha` (`removerDaTrilha`) — sem estorno na UI
    não há mais borderô travado; era código morto + risco de dupla-baixa.
  - **P0** testes diretos das regras de saldo automático (`autoAlocarSeElegivel`/`autoAlocarDeCasamento`,
    `GestaoPermutas.autoElegivel`).
  - **P1** auto-alocação ATÔMICA (all-or-nothing): falha parcial reverte os rascunhos (sem meia-permuta).
  - **P1** `requireRole('admin')` nos GETs `/borderos`, `/borderos/:borCod/baixas`, `/status`.
  - **P1** Zod/guard de identidade nas reads do ERP (`listInvoicesFinalizadas`/`listBorderos`/`listBaixas`)
    + log de cap-hit (truncamento de paginação).
  - **P1** índices de performance (migration 0019) p/ o hot path de borderôs.

## v0.6.1 (2026-06-24) — Regis-Review 2026-06-24-0039: remediação dos P0 de código

- **fix(security):** autorização **server-side** nas ações de borderô (confused-deputy). As ações
  (aprovar/cancelar/estornar/excluir baixa+borderô) só agem sobre borderôs **da trilha deste sistema**;
  o `filCod` vem da TRILHA, nunca do request → admin/JWT não mexe em borderô de terceiro via API.
  Erro `FORBIDDEN:` → HTTP 403 no route. Testes de autorização adicionados.
- **fix(security):** senhas **individuais** para os 4 admins kavex (eram iguais) + bcrypt cost 10→12
  (seed-admin e os 4 usuários).
- **fix(integrability):** **Zod no boundary** das escritas fin010 que viram confirmação persistida —
  `criarBordero` exige `borCod` numérico, `gravarBaixaPermuta` exige `bxaCodSeq` (senão aborta, sem
  borderô fantasma / settled errado).
- **test(integrability/testability):** **contract tests** do fin010 no `ConexosClient` (paths/payloads),
  incluindo a **regressão do bug docTip-vs-filCod** (2º segmento do DELETE baixa é o docTip).
- **chore(deploy):** flags de escrita (`CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`/`CONEXOS_BASE_URL`)
  passam a ser **fonte única no dashboard do Render** (`sync:false`) — fim do blueprint sobrescrevendo
  o dashboard a cada deploy.

## v0.6.0 (2026-06-24) — Fase 3.1: gestão de borderôs (ciclo completo no fin010)

Aba **Borderôs** — revisão e gestão dos borderôs de permuta com **status ao vivo do ERP** (fonte:
`fin010/list`, `borVldTipo=2`), e o ciclo de vida completo automatizado via o próprio Conexos.

- feat(permutas): `BorderoGestaoService` — listar (do ERP, enriquecido com a trilha), **Aprovar**
  (`finalizar`), **Cancelar**, **Estornar** (volta p/ em cadastro) e **Excluir** baixa/borderô.
  Contratos sondados por HAR: `POST /fin010/{finalizar,cancelar,estornar}/{borCod}`,
  `DELETE /fin010/{borCod}`, `DELETE /fin010/baixas/{borCod}/{docTip}/{docCod}/{titCod}/{bxaCodSeq}`
  (2º segmento é o **docTip**, não o filCod), `POST /fin010/baixas/list/{borCod}`.
- feat(frontend): aba `/permutas/borderos` — filtros (borderô, usuário, filial, situação, data),
  ações com modal de confirmação, situação ao vivo; ações só nos borderôs criados por este sistema.
- feat(permutas): **data do borderô** escolhida no modal de baixa (default = data da D.I/DUIMP),
  resolvendo `FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE` em períodos fechados.
- feat(permutas): idempotência **viva** — borderô cancelado/estornado/removido libera o relançamento
  preservando o histórico (renomeia a chave).
- fix(permutas): erros do ERP traduzidos para PT (400 com mensagem) em vez de 500 genérico.
- chore(auth): usuários admin (francinei/grazi/simone/rogerio @kavex.com) no `app_user`.

## v0.5.0 (2026-06-23) — Fase 3: write-back fin010 (baixa/permuta efetiva no ERP)

A **primeira escrita** do sistema no Conexos — o risco arquitetural #1. A ação `reconciliarPermuta`
consome as alocações e executa a baixa no `fin010` adto a adto, via o **handshake de 5 chamadas**
descoberto por engenharia reversa de um HAR real. **Gated** (escrita desligada + dry-run por padrão,
homologação-first). ADR-0013, ontologia v0.3.0.

- feat(permutas): `ReconciliacaoPermutaService` + métodos de escrita no `ConexosClient`
  (criarBordero/validarTituloBaixa/validarTituloPermuta/atualizarValorLiquido/gravarBaixaPermuta via
  `postGeneric` → `authenticatedPost`). Rotas `POST /adiantamentos/:docCod/reconciliar` e `GET .../execucoes`.
- feat(permutas): write-ahead + idempotência por par adto↔invoice (`permuta_alocacao_execucao`, 0015).
  Guard-rails via `EnvironmentProvider` (`CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`).
- feat(frontend): ação "Baixar" na aba cross-process → modal de preview (dry-run) + "Executar baixa".
- fix(permutas): remediação dos P0 do Regis-Review 2026-06-23-1518 (10/10):
  - escritas (criarBordero/gravarBaixaPermuta) fora do `RetryExecutor` → sem baixa duplicada;
  - anti-drift I-Write-1 (aborta se o ERP quer baixar > alocado esperado);
  - `borCod` persistido no write-ahead (recuperação de borderô órfão);
  - envelope `messages` (`valid='ERRO'` aborta); testes do `PermutaExecucaoRepository`;
  - flags em `render.yaml`/`.env.example` + runbook `docs/runbooks/fin010-write-cutover.md`.
- Pendente (P1/P2/P3 → inbox): validar contrato single-HAR em homologação (baixa parcial, DESCONTO,
  finalização do borderô) antes de `CONEXOS_WRITE_ENABLED=true` em produção; ADR multi-tenant; deadline/cap
  na rota; separar write client; extrair modal do `page.tsx`.

## v0.4.2 (2026-06-22) — hardening: coalescing da ingestão + escopo do rate limiter (Lote B do Regis)

- fix(perf): mata o HTTP 429 do fluxo de cliente-filtro (cc-auto-ingest-coalesce).
  - O `heavyRouteLimiter` (10/min) deixa de cobrir o router `/permutas` inteiro — aplicado por-rota só em
    `POST /eleicao` e `POST /ingestao`; leituras (gestao/painel/cliente-filtro/importadores) ficam no
    `globalLimiter` (100/min). Antes o `load()` + painel + ingestão dividiam 10/min → 429.
  - Novo `IngestaoCoalescerService` (`@singleton`) na frente da ingestão: cliques em sequência coalescem
    numa rodada + rerun-trailing (inclui a mudança de quem entrou no meio), em vez de disparar fan-out
    Conexos redundante. Mantém SÍNCRONO (preserva a UX do remover). Contenção cross-instância (cron) segue
    `IngestLockBusyError` → 409. ADR-0012. READ-ONLY no Conexos.
- chore(test): higiene de teste (Lote C do Regis — test-only, sem bump).
  - testability-1: sandbox do `EnvironmentProvider.test` — mocka o `dotenv` (config no-op) pra o teste
    não depender do `.env` do dev (antes `CONEXOS_FIL_COD` local contaminava o cenário "ausente" e a
    suíte tinha 1 falha ambiental). Suíte BE agora 100% verde.
  - testability-3: `collectCoverageFrom` no frontend — passa a medir TODO o código-fonte (antes ~10 de
    34 arquivos → número "Potemkin" ~82%). Baseline real ~26.8% lines; floors do `coverageThreshold`
    recalibrados logo abaixo do real (pega regressão, CI verde). Subir conforme testes forem adicionados.

## v0.4.1 (2026-06-22) — hardening de API (Lote A dos P0 do Regis-Review)

- fix(security): RBAC server-side nas rotas de mutação de permutas (security-1).
  - Middleware `requireRole('admin')` (`http/auth.ts`) gateia `POST /eleicao`, `/ingestao`,
    `POST/DELETE /cliente-filtro`, `POST/DELETE /alocacoes`, `POST /processar`; leituras seguem abertas a
    qualquer usuário autenticado. Role vem do JWT (`app_user.role`, default `admin`). 401 sem sessão, 403
    sem role. ADR-0011. Tactic Bass: Authorize Actors.
- fix(security): redação de campos sensíveis no request/response logger (security-3).
  - `redactBody()` (`http/redact.ts`) mascara password/token/authorization/secret/api_key antes do
    `JSON.stringify` — para de vazar a senha do `POST /auth/login` no stdout/log drains. Tactic Bass: Limit Access.
- nota: o timeout HTTP do Conexos (performance-2) já existia (`services/conexos.ts` `timeout: 40000`) — finding
  rebaixado (medira o wrapper DDD). Demais P0 (auto-ingest coalescing, sandbox de teste, coverage FE,
  isolamento Supabase, rollback, rotação de segredos) → Lotes B/C e ops.

## v0.4.0 (2026-06-22) — permutas: distribuição greedy Simples + refinos de cliente-filtro/painel

- feat(permutas): distribuição greedy N:1 com teto na permuta Simples (auto-casamento parcial, READ-ONLY).
  - A aba Simples (1 invoice : N adiantamentos) deixa de usar o valor cheio de cada adto: distribui o
    em-aberto VIVO da invoice (`getDetalheTitulos.valorAberto`/taxa, novo `Invoice.valorAbertoNegociado`)
    entre os adtos casados — maior saldo primeiro, desempate por aging, com saldo residual quando sobra
    (caso 1408: "usa 260.064" em vez de 743.040, 11566 com residual 408.672).
  - Variação cambial recalculada sobre o valor PARCIAL. `GestaoPermutasService` expõe `saldoRestante` no
    casamento Simples; frontend ganha a coluna "Saldo restante". Ontologia v0.2.9 (ADR-0010). Baixa real
    em `fin010` segue Fase 3.
- feat(permutas): cliente-filtro roteia automaticamente ao adicionar E ao remover.
  - Adicionar/remover um importador dispara a ingestão (mesmo compute do cron) para alinhar o painel na
    hora. No remover, o item só sai da lista após a re-ingestão concluir (spinner até o fim); se a
    ingestão falhar, o filtro é mantido (cadastro coerente com o painel). 409/429 tratados.
- feat(permutas): transparência na alocação manual e no painel.
  - Modal de alocação (múltiplas/cross-over/cross-process) mostra a CONTA do juros/desconto
    (`valor × (taxaAdto − taxaInvoice)`) e o saldo DISPONÍVEL da invoice compartilhada (líquido das
    alocações de outros adiantamentos, novo `InvoiceBuscada.jaAlocado`).
  - Painel: badge "fonte: banco" (sem "local") + carimbo "última ingestão" (último run `kind='ingest'`
    bem-sucedido) em horário de Brasília.

## v0.3.0 (2026-06-20) — permutas: ingestão manual de dados (Frente I)

- feat(permutas): botão "Ingestão de dados" no painel + modal que roda a pipeline sob demanda.
  - Backend: `POST /permutas/ingestao` (dispara `IngestaoPermutasService`, mesmo compute do cron, espera concluir) + `GET /permutas/runs` (trilha de auditoria das últimas rodadas, Zod no `?limit`).
  - Concorrência: `IngestLockBusyError` (advisory lock existente) → HTTP 409, sem fan-out duplicado nem run de erro na trilha.
  - Auditoria: `triggered_by` = username do token verificado server-side (cron = `'cron'`); exposto no modal ("analista X" vs "cron job", quando, status, totais).
  - Frontend: modal com aviso da ação, histórico das rodadas e "Rodar agora" (espera no modal com spinner → atualiza painel). Sonner para feedback.
  - READ-ONLY no Conexos (I4 preservado); risco #1 (write-back `fin010`, Fatia 2) intocado.
  - Ontologia v0.2.3 (ADR-0006). PatternGuardian + DesignSystemReviewer sem violações.
- feat(permutas): progresso de pagamento nos bloqueados por "Não totalmente pago".
  - Detalhe Conexos (`getDetalheTitulos`) passa a carregar `valorTotal` (`mnyTitValor`) + `valorAberto` (`mnyTitAberto`) — zero fan-out novo.
  - UI: campo "Progresso de pagamento" no detalhe da linha → "X% pago · falta R$ … (≈ US$ …)". Gate 3 intocado (só visibilidade).
  - migration `0010` (`valor_total`/`valor_aberto`), helper `progressoPagamento` + testes. Ontologia v0.2.4. Gates de revisão sem violações.
- feat(permutas): cliente-filtro + estado "permuta manual" (permuta múltipla manual cross-process — Fase 1).
  - Cadastro de importadores "filtro" (`/permutas/clientes-filtro`): a pipeline roteia os adtos deles (pago + saldo) para o novo estado `permuta-manual` em vez de bloqueada.
  - Importador hidratado na eleição (`imp021`) e persistido (`pes_cod`/`importador`); novo KPI/filtro/badge "Permuta manual" (token `permuta` violeta).
  - Backend: `ClienteFiltroRepository` + rotas CRUD `/cliente-filtro` + `GET /importadores`; override de roteamento em `EleicaoPermutasService`; migrations `0011`-`0013`.
  - READ-ONLY no ERP (I4); cross-process/alocação/escrita = Fases 2/3. Ontologia v0.2.5 (ADR-0007). PatternGuardian + DesignSystemReviewer sem violações.
- feat(permutas): alocação manual N:M cross-process (permuta múltipla manual — Fase 2).
  - O analista, a partir de um adto "permuta manual", busca invoices de qualquer processo (live no Conexos, valida D.I) e distribui valores parciais (N:M); rascunho editável, READ-ONLY no ERP.
  - Backend: tabela `permuta_alocacao` (migration `0014`, sobrevive à ingestão) + `PermutaAlocacaoRepository` + `AlocacaoPermutasService` (valida saldo dos 2 lados → 422, variação pela taxa da invoice) + rotas `GET /invoices/buscar` e POST/DELETE `/alocacoes`; alocações + saldo restante no `/gestao`.
  - Frontend: ação "Alocar invoice" + modal (busca por processo, distribui valor, lista alocações). Ontologia v0.2.6 (ADR-0008). Baixa no `fin010` = Fase 3 (risco #1).
- feat(permutas): tipos de permuta em abas (simples/múltiplas/cross-over/cross-process) + topo só resumo.
  - Classificação derivada `tipoPermuta` no backend (sem novo estado): por cardinalidade do processo (>1 adto casamento-manual → cross-over, senão múltiplas; permuta-manual → cross-process; elegível → simples).
  - Topo enxuto (Pendentes · Invoices em aberto · Já permutado · Bloqueadas); 4 abas na área de trabalho (cross-process com "Alocar" da ADR-0008, aba própria). Fix: busca de invoice filtra "em aberto" pelo detalhe (o `pago` da lista é null/inconfiável). Ontologia v0.2.7 (ADR-0009).
  - Cada aba ganhou filtro (filial + busca por código/exportador/processo) + paginação própria (hook `useTabelaFiltro` + `FiltroBarra`/`Paginacao`), espelhando a tabela principal.
  - Alocação N:M unificada: Múltiplas e Cross-over passaram a usar o mesmo mecanismo do Cross-process (distribuir o saldo de 1 adiantamento em VÁRIAS invoices, parcial, com saldo restante). Removido o fluxo antigo de invoice única ("Resolver"). Backend calcula `saldoRestante`/`alocacoes` também para casamento-manual.
  - Correções da busca de invoice: escopo por FILIAL (o `priCod` não é único entre filiais — `buscarInvoices(priCod, filCod)`); trava de moeda (não permuta USD × BRL); same-process para múltiplas/cross-over; "em aberto" via detalhe.

## v0.2.0 (2026-06-18) — permutas: painel de elegíveis (Frente I, Fatia 1)

- feat(permutas): painel de pendências elegíveis read-only — automação das etapas 1–5 do fluxo manual.
  - Leitura Conexos: `listAdiantamentosProforma`, `listDeclaracaoByProcesso` (D.I/DUIMP).
  - Domínio: elegibilidade (4 gates), casamento 1:1, variação cambial (juros/desconto por taxa), aging, eleição, painel.
  - Persistência: 1ª migration do repo + runner; snapshot + auditoria com transação atômica.
  - Endpoints: `POST /permutas/eleicao` (trigger manual), `GET /permutas/painel`.
  - Ontologia v0.2.1 (5 entidades, 5 ações, ADR-0004); Regis-Review `2026-06-17-2340` + 7 P0 remediados.
  - Em aberto (não-bloqueante): probe P0-4 (campo wire da data-base) liga a coluna *aging* depois.

## v0.1.0 (2026-06-10) — bootstrap

- chore(bootstrap): template virgem porém rodável a partir de `fechamento-processos` v0.10.2
  - Meta-camada: `.claude/` (19 agentes + 13 comandos), `ontology/` (charter + estrutura, domínio vazio), `CLAUDE.md`, configs (biome/tsconfig/CI).
  - Backend Express/DDD rodável: `/health`, auth Supabase, container tsyringe, libs, `ConexosClient` (mesmo tenant), rota de exemplo `GET /conexos/filiais`.
  - Frontend Next.js rodável: shell autenticado, login Microsoft (Supabase), Design System, página inicial placeholder.
  - Sem features de domínio (modeladas depois via `/feature-new`). Ver ADR `ontology/decisions/0001-bootstrap-financeiro.md`.
  - Gates verdes no bootstrap: backend (typecheck/lint/232 testes/build), frontend (typecheck/lint/34 testes/build).

> Versão **do app** (frontend + backend em **lockstep** — mesmo número nos dois `package.json`).
> Exibida na UI (badge/título, `src/frontend/app/layout.tsx`) e no `/health` do backend.
> Mantida pelo `scripts/bump-version.ps1` na fase Ship do pipeline (semver por conventional-commit).
>
> NÃO confundir com `ontology/CHANGELOG.md`, que versiona a **ontologia** (domínio/regras).
