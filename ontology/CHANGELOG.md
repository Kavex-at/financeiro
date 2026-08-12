# Ontologia Financeiro — Changelog

> Versão **da ontologia** (domínio/regras). NÃO confundir com a versão **do app**
> (`/CHANGELOG.md` na raiz, FE+BE lockstep). Conceitos separados, cadências próprias.

## v0.18.0 — descrição do item da NDe é do DOCUMENTO, não do cadastro (2026-08-11, ADR-0036)

Feature: `nde-descricao-item` (branch `fix/nde-descricao-item`, base `main`). A homologação da NDe era
recusada para os clientes cujo cadastro (`cmn025` → `CmnDadosPessoas.dpeVld1DescrNfe`) manda derivar a
descrição do produto da **DI** (`4 - Descrição DI`; o tenant rotula "DI + DUIMP"): o produto de encargo da
NDe (`41978` PAGAMENTO ANTECIPADO) não tem adição de DI, então a **Descrição para Impressão**
(`dprLngDescrNf`, o `xProd` da NF-e) saía **vazia**.

- **NEW business-rule `descricao-item-nde` (I-Receb-5, `implemented`)** — antes da leg fiscal, se a
  descrição do item estiver vazia ela é gravada **no documento** (`PUT com297/comDocProdutos`,
  read-modify-write, sucesso ⟺ eco não-vazio). Ordem do texto: `NDE_DESCRICAO_ITEM_FALLBACK` →
  `preDescrProdutoNf` (o que o próprio ERP calcularia) → `prdDesNome` da linha → constante.
  → **business-rules 20 → 21**.
- **`integrations/conexos-nde-fiscal` ganha a etapa (0)** na ordem obrigatória:
  `(0) descrição do item → (a) fiscal → (b) observações → (c) homologar`, com 1 endpoint de escrita e 3 de
  leitura novos em `com297/comDocProdutos`.
- **Nada muda no cadastro.** O `dpeVld1DescrNfe` do cliente é **legítimo** como está — para a NF-e de
  **mercadoria** descrever a DI/DUIMP é o comportamento fiscal desejado. Trocá-lo consertaria a NDe e
  quebraria o faturamento; e é dado-mestre versionado (`dpeCodSeq`), compartilhado.
- **Sem entidade nova, sem máquina de estado nova, sem migração.** A regra é idempotente pelo estado do
  **documento** (descrição preenchida ⇒ no-op) e **não** ganhou etapa no ledger de propósito: as execuções
  que já falharam por isso pararam em `obs-done` e uma etapa monotônica as pularia na retomada.

## v0.14.0 — Frente IV: alocar contra uma SN existente (2026-08-03, ADR-0027)

Feature: `alocar-sn-select` (branch `fix/alocar-sn-select`, base `fix/erp-4xx-nao-retentavel`). O botão
**"Processar"** (modal "Alocar processos" em `/recebimentos`) deixa de **sempre mintar uma SN nova**: as
Solicitações de Numerário **já existentes** do processo passam a ser **listáveis/selecionáveis**, e
"Processar" fica **gated na seleção**.

- **NEW action READ `listarSolicitacoesNumerario`** (entity `SolicitacaoNumerario`, `planned`): lista as
  SNs de um processo. Contrato **HAR-confirmado (2026-08-03)**: `POST /api/com299/list`,
  `filterList = { priCod#EQ, docVldTipo#EQ:9, docVldTipoAdto#EQ:1, vldStatus#IN:['1','3'] }`, ordenado
  `docCod` desc, paginado; envelope `{ count, pageNumber, rows[] }`. **Discriminador SN:** `docVldTipo=9`
  **E** `docVldTipoAdto=1` (uma NC/ND é `docVldTipoAdto=0` → excluída). Projeção: `docCod` (handle),
  `docEspNumero` (numero), `docDtaEmissao` (data), `tpdDesNome`/`gcdDesNome` (descricao), `vldStatus`
  (status), `mnyBruto` (solicitado), `docMnyValor` (valor do doc). READ-only. → **actions 22 → 23**.
- **`gerarSolicitacaoNumerario` ganha um ramo "SN existente":** quando um `docCod` é selecionado, **pula**
  `com299/gerDocProcesso` **e** `completarSnAdiantamento` e roda direto `fin014` + `com297` contra o
  `docCod`. "Criar novo SN" segue o fluxo completo, inalterado. Mesma ação (contagem inalterada).
- **NEW business-rule `alocacao-sn-existente` (I-Receb-3, `planned`):** **(a)** valor alocado ≤ **saldo do
  TÍTULO** da SN; **(b)** sem duplicata (com299 pulado); **(c)** humano confirma a seleção. **Distinto de
  I-Receb-1** (`invariante-rateio`: Σ das alocações ≤ `transacao.valor`). → **business_rules 16 → 17**.
- **⚠️ Saldo NÃO vem da lista (document-level):** `com299/list` devolve `mnyBruto`/`docMnyValor` (valor do
  documento), **não** o saldo remanescente por-título — o "Saldo" do mockup e o teto do I-Receb-3 vêm do
  título (`lov/TituloBorderoReceber`) que a **baixa `fin014` já lê**. O **enforcement** do teto ≤ saldo é a
  **baixa/título**, não a lista. Open-gap `sn-list-saldo-document-level` (P1) na integração.
- **Integração `conexos-com299-gerdoc`:** `direction` write → **read-write** (NEW `endpoints_read`
  `com299/list`). Total de integrações inalterado (5).
- **State-machine `recebimento`:** transição **R1** anotada (a alocação pode gerar SN nova OU alvo uma SN
  existente — **ramo do settle, não estado novo**).
- **Sem entidade nova:** a `SolicitacaoNumerario` já é first-class; ganha a **projeção de leitura** + a
  relação **N—1 `Recebimento`** (settle contra existente).
- **Rejeitados (ADR-0027):** novo estado na máquina (é ramo de R1); duas ações de settle separadas (basta
  um branch); usar `docMnyValor` da lista como saldo (document-level); modelar "Processar após seleção"
  como estado de UI (é precondição); valores de exibição/`gcdCod` (config do tenant).

Emenda ADR-0022/0024/0025; não supersede nenhum.

## v0.3.0 — Fase 3: write-back `fin010` (baixa/permuta efetiva no ERP) (2026-06-23, ADR-0013)

Feature: `permutas-reconciliacao` (branch `feat/permutas-reconciliacao`, verde). A **primeira ESCRITA** do
sistema no Conexos — o **risco arquitetural #1**. A ação **`reconciliarPermuta`** sai de `planned` →
`partial`: consome as alocações (`permuta_alocacao`) e executa a baixa no `fin010` **adto a adto**.

- **Contrato (engenharia reversa de HAR real):** a baixa é um **handshake de 5 chamadas** (criar borderô →
  validar `tituloBaixa` → validar `tituloPermuta` → `atualizaValorLiquido` → gravar `baixas`). O ERP é a
  fonte da verdade do valor (`bxaMnyValor` do passo 2). Documentado em `business-rules/fin010-write-contract.md`.
- **Estado `EXECUTADA`** entra na máquina (T5); sai de `out_of_scope_states`. `ConexosClient` ganha métodos
  de **escrita** (`criarBordero`, `validarTituloBaixa`, `validarTituloPermuta`, `atualizarValorLiquido`,
  `gravarBaixaPermuta`) via `postGeneric` → `authenticatedPost`.
- **Guard-rails:** `CONEXOS_WRITE_ENABLED` (default false) + `CONEXOS_DRY_RUN` (default true);
  **homologação-first**. Dry-run monta/loga o payload sem POST.
- **Fault-tolerance:** write-ahead + idempotência por par adto↔invoice (`permuta_alocacao_execucao`,
  `business-rules/idempotencia-reconciliacao.md`). Anti-super-pagamento: em-aberto vivo do ERP ≤ 0 → aborta.
- **Pendente:** validação em produção do 1º caso real; baixa parcial (invoice N:M); finalização do borderô;
  caminho `DESCONTO`.

## v0.2.9 — distribuição greedy N:1 com teto na permuta Simples (2026-06-22, ADR-0010)

Feature: `permutas-distribuicao-simples-greedy` (branch `feat/permutas-multiplas`, verde). Corrige a
**super-permuta** do auto-casamento Simples (1 invoice : N adiantamentos). READ-ONLY no ERP — corrige só
o nosso snapshot/cálculo (`permuta_casamento`); a baixa em `fin010` (`reconciliarPermuta`) segue **Fase 3**.

- **Antes:** cada adto do grupo usava o valor **cheio** negociado, sem teto. Caso real **1408** (ZNSHINE,
  INVOICE 260.064; adtos 11566=668.736, 5751=74.304) somava **"usa 743.040"** (super-permuta de ~483 k).
- **Agora (4 decisões travadas — ADR-0010):** distribui o **em-aberto vivo da invoice** entre os adtos —
  (1) **ordenação** maior saldo primeiro; (2) **desempate** mais antigo (aging desc; fallback dataEmissao);
  (3) **teto** = em-aberto vivo da invoice (`mnyTitAberto / taxaInvoice` via `getDetalheTitulos`), fallback
  `valorMoedaNegociada`, ausente ⇒ sem teto (legado); (4) **residual** — auto-casamento ficou **parcial**
  (adto consumido em parte mantém saldo restante em aberto; variação recalculada sobre o valor parcial).
- **1408 corrigido:** 11566 usa **260.064** (residual 408.672), 5751 usa **0** → "usa 260.064". Caso
  inverso (Σ adtos < invoice): todos usados por inteiro, invoice parcialmente permutada.
- **Nova entidade-propriedade `Invoice.valorAbertoNegociado`** (o teto, em moeda negociada) e
  `CasamentoAdiantamento.saldoRestante` (exposto na aba Simples, coluna "Saldo restante").
- **Nova business-rule `distribuicao-simples-greedy`** (invariante `I-Permuta-2` aplicada ao
  auto-casamento) — **primeira regra com teste canônico** (`has_canonical_test: true`). Entidades
  `Invoice`/`Adiantamento`/`PermutaCandidata`/`Permuta` atualizadas; `_index.json`/`_coverage.json`
  re-carimbados v0.2.8 → **v0.2.9** (business-rules 4 → 5, com teste 0 → 1).
- **Moeda diferente** continua bloqueada (regra existente). **Ponto aberto** (watchlist): residual grande
  num único adto (1408: 408.672) — validar com o time se deve virar caso de **revisão manual**.

## v0.2.8 — sync ontologia ↔ código deployado (2026-06-21, commit df90fa6)

Curadoria de sincronização (a ontologia havia ficado defasada das 5 features de permutas mergeadas
na `main`/deployadas). Sem novas decisões de domínio — materializa o que os ADRs 0006-0009 já
decidiram e alinha o metadado ao `src/`.

- **Nova entidade `Permuta`** (`entities/permuta.md`) — a Permuta consumada / **alocação** (era
  backlog "Fatia 2" no `permuta-candidata.md`). Hoje = ALOCAÇÃO rascunho (`permuta_alocacao`),
  READ-ONLY no ERP. `implementation_status: partial` (alocação implementada; baixa `fin010` /
  ação `reconciliarPermuta` = **Fase 3 = planned**, risco arquitetural #1). ADR-0008.
- **Nova entidade `ClienteFiltro`** (`entities/cliente-filtro.md`) — config de roteamento por
  importador (`cliente_filtro`) que roteia adtos pago+saldo para `permuta-manual`.
  `implementation_status: implemented`. Estrutura na ontologia; valores = config do cliente. ADR-0007.
- **State-machine** `elegibilidade-permuta-candidata` ganhou o estado **`PERMUTA_MANUAL`** (T4,
  cliente-filtro: pago+saldo, D.I dispensada, cross-process) + a classificação **derivada
  `tipoPermuta`** (simples/multiplas/cross-over/cross-process, ADR-0009). Status `partial`
  (EXECUTADA/baixa fin010 = Fase 3).
- **Sync de status/impl_files**: as entidades/ações/regras da Fatia 1 (Adiantamento, Invoice,
  DeclaracaoImportacao, VariacaoCambial, PermutaCandidata; 5 ações; 4 business-rules; integração
  Conexos) passaram de `planned` → `implemented` com `impl_files` reais. `_index.json`/
  `_coverage.json` re-carimbados v0.2.2 → **v0.2.7** (cobertura entidades 93%, ações 88%).
- Gap **gate-3-pago-via-detail** RESOLVIDO na impl (status TOTALMENTE PAGO + progresso de pagamento
  via `getDetalheTitulos`: `mnyTitValor`/`mnyTitAberto`, migration 0010). Adiantamento ganhou as
  propriedades `valorTotal`/`valorAberto`/`pesCod`/`importador`.
- Interview/tasks da Fatia 1 (já mergeada) **arquivados** em `_inbox/archive/` (não disparam mais
  o gate de PR de `entity_changed`).

## v0.2.7 (2026-06-21) — tipos de permuta em abas + topo resumo (ADR-0009)

Refinamento de apresentação (sem novo estado no banco). Classificação DERIVADA `tipoPermuta`
(`simples`/`multiplas`/`cross-over`/`cross-process`) calculada em `GestaoPermutasService` a partir do
estado + cardinalidade do processo (nº de adtos casamento-manual no priCod: >1 → cross-over, senão
multiplas; permuta-manual → cross-process; elegível → simples).

- **Topo enxuto**: KPIs viram só resumo (Pendentes · Invoices em aberto · Já permutado · Bloqueadas).
- **Área de trabalho = 4 abas**: Simples · Múltiplas · Cross-over · Cross-process (cross-process com a
  ação "Alocar" da ADR-0008; aba própria por ser cross-process, não dobrada em cross-over). Cada aba tem
  filtro próprio (filial + busca) + paginação (espelha a tabela principal).
- READ-ONLY no ERP; sem migration/reseed (derivação a cada leitura). Também correção do filtro "em aberto"
  da busca de invoice (usa o DETALHE, não o `pago` da lista — inconfiável). PatternGuardian 100%; Design ok.

## v0.2.6 (2026-06-20) — alocação manual N:M cross-process (Fase 2, ADR-0008)

Feature: `permutas-alocacao` (branch `feat/permutas-multiplas`). A `Permuta` consumada (backlog da Fatia 2
no ADR-0004) nasce como **alocação** — READ-ONLY no ERP; a baixa em `fin010` é a Fase 3.

- **Entidade alocação (`permuta_alocacao`).** Links livres adto↔invoice (cross-process, N:M, valores
  parciais), UNIQUE por par, sobrevive à re-ingestão. Invariantes de saldo (moeda negociada): Σ por adto
  ≤ saldo a permutar; Σ por invoice ≤ valor em aberto → excesso = `AlocacaoSaldoError` (422).
- **Busca LIVE cross-process** (`buscarInvoices` por nº de processo): consulta Conexos (todas as filiais),
  enriquece valor/taxa (com308), valida **D.I/DUIMP** (invoice sem D.I é omitida). Re-valida no alocar.
- **Variação cambial** recalculada pela taxa da INVOICE + valor parcial; data-base da D.I da invoice.
- **UI:** ação "Alocar invoice" nas linhas `permuta-manual` + modal (busca, distribui valor, lista
  alocações, saldo restante). Rascunho editável; sem write-back. Migration 0014. ADR-0008.

## v0.2.5 (2026-06-20) — cliente-filtro + estado `permuta-manual` (Fase 1, ADR-0007)

Feature: `permutas-cliente-filtro` (branch `feat/permutas-multiplas`). Permuta múltipla MANUAL
cross-process — Fase 1 (cadastro + roteamento; alocação/escrita = Fases 2/3).

- **Novo estado `permuta-manual`** na máquina de elegibilidade (5º estado):
  `descoberta | elegivel | casamento-manual | permuta-manual | bloqueada`. Adtos de cliente-filtro
  pagos e com saldo, prontos p/ permuta manual cross-process. Motivo `cliente-filtro`.
- **Cadastro `cliente_filtro`** (por importador `pesCod`, mantido pelo analista no frontend). A pipeline
  roteia os adtos desses importadores: `BLOQUEADA && pago && saldo>0 → permuta-manual` (D.I não exigida na
  manual; Gate 4 segue obrigatório na automática).
- **Importador hidratado** na eleição (`imp021` via `listProcessos`) e persistido no fato
  (`pes_cod`/`importador`). Resolve o "0 invoices" do 1153 e dá visibilidade do dono do adto.
- **Cross-process / alocação / escrita** = Fatia 2/3 (esta fase só sinaliza e enfileira). I4 intocado.
- Migrations 0011 (importador), 0012 (CHECK +permuta-manual), 0013 (cliente_filtro). ADR-0007.

## v0.2.4 (2026-06-20) — progresso de pagamento dos bloqueados por `nao-pago`

Feature: `permutas-pagamento-parcial` (branch `feat/permutas-multiplas`). Exibição read-only;
**nenhuma entidade/ação/regra nova** — adição de campo derivado do detalhe já buscado.

- **Contrato de integração (conexos.md).** O detalhe `com298/{docCod}` (`getDetalheTitulos`) passa a
  retornar também `valorTotal` (`mnyTitValor`, face) e `valorAberto` (`mnyTitAberto`, saldo) — além de
  `valorPermutar`/`pago`/`valorPermutado`. Zero fan-out novo (mesma chamada do Gate 2/Gate 3).
- **UI.** No detalhe da linha, bloqueados por `nao-pago` mostram **% pago + quanto falta** (R$ e ≈USD,
  derivado pela taxa). Identidade `mnyTitValor = mnyTitPago + mnyTitAberto` (já documentada).
- **Gate 3 INTOCADO.** Continua `pago ⟺ mnyTitAberto === 0`. Isto é só visibilidade — **não** permite
  desbloquear/permuta parcial (decisão de domínio I3 / follow-up `vc-permuta-parcial`, Fatia 2).

## v0.2.3 (2026-06-20) — ingestão MANUAL no painel de Permutas (ADR-0006)

Feature: `permutas-ingestao-manual` (branch `feat/permutas-multiplas`). Trigger
humano para a ingestão existente, entre os horários do cron. **Nenhuma entidade
ou ação nova** — interface operacional + exposição da auditoria já persistida.

- **ADR-0006 — trigger manual.** `POST /permutas/ingestao` dispara o MESMO compute
  do cron (`IngestaoPermutasService`) e espera concluir; a tela aguarda no modal.
  *Human-in-the-loop* (I1): o analista decide quando rodar.
- **Auditoria exposta (I5/O6).** `GET /permutas/runs` lista as últimas rodadas
  (cron + manuais) — quem rodou, quando, status, totais. `triggered_by` = username
  do token **verificado server-side** (não spoofável); cron = `'cron'`.
- **Concorrência bloqueada.** Rodada manual concorrente a uma em andamento (cron ou
  outro analista) → `IngestLockBusyError` (advisory lock existente) → **HTTP 409**,
  sem segundo fan-out no Conexos e sem run de erro na trilha (contenção ≠ falha).
- **I4 preservado.** Somente leitura no ERP; risco #1 (write-back `fin010`, Fatia 2)
  intocado. Mitiga parcialmente O4 (sem scheduler próprio; o cron segue externo).

## v0.2.2 (2026-06-18) — P0-3 e P0-4 RESOLVIDOS por probe de rede empírico

Feature: `permutas-painel-elegiveis`. Probe de rede no **dev tenant Columbia** (2026-06-18,
`filCod=2`, validado contra **410 adiantamentos reais**). Addendum 2026-06-18 ao ADR-0004.

- **P0-3 (filtro "Adiantamento=SIM") — RESOLVIDO.** A chave wire do filtro de adiantamento é
  **`docVldTipoAdto` = `1`** (modelo `FinDocCab`). O placeholder anterior (`adiantamento#EQ`/`'S'`)
  era um **BUG**: retornava **HTTP 500 `adiantamento (FinDocCab)`** (campo inexistente). Evidência:
  PROFORMA com `docVldTipoAdto=1` carregam `gerNum=198` (ADTO FORNECEDOR INTERNACIONAIS) e
  `gcdDesNome="ADIANTAMENTO PROFORMA"`. Já plugado em `conexosPermutasConstants.ts`. **Deixa de ser
  build-probe.**
- **P0-4 (campo wire data-base D.I/DUIMP) — RESOLVIDO.** D.I (`imp019`): **`cdiDtaCi`** (data "CI",
  epoch-ms; acompanha `cdiEspNumci` = nº da CI; confere com o PDF "DI = CI"). DUIMP (`imp223`):
  **`dioDtaDesembaraco`** (data de desembaraço, epoch-ms). **XOR DI/DUIMP confirmado em dados reais.**
  Já plugado em `ConexosClient.mapDeclaracaoDataBase`. **A coluna aging agora popula.** Deixa de ser
  `blocked-by: P0-4`. **Não há mais gap P0 aberto nesta fatia.**
- **NOVO GAP — `gate-3-pago-via-detail` (P1, descoberto pelo probe).** Nos 410 adiantamentos reais,
  o `com298/list` traz `mnyTitAberto=null` / `mnyTitPago=null`, então `isPago` retorna `false` para
  TODOS — o **Gate 3 (TOTALMENTE PAGO) bloquearia tudo**. O status pago provavelmente mora no
  **endpoint de detalhe** (modal financeiro), igual ao `mnyTitPermutar`. **Bloqueante** para a
  feature produzir ALGUMA candidata elegível; NÃO foi escopo do probe. Registrado no interview +
  regis-followups.
- **Gaps P0 abertos: 1 → 0.** Migration-debt O3: re-introdução dos reads D.I/DUIMP com data-base
  CONCLUÍDA.

## v0.2.1 (2026-06-17) — respostas dos gaps P0 (Yuri) encodadas

Feature: `permutas-painel-elegiveis`. Yuri respondeu os gaps P0; addendum ao ADR-0004.

- **P0-1 (juros vs desconto) — RESOLVIDO.** Regra canônica = **comparação de TAXA de câmbio**
  (não de valor): `delta = principalMoeda × (taxaInvoice − taxaAdiantamento)`. `delta>0` → **JUROS**
  (conta **131**, passiva); `delta<0` → **DESCONTO** (conta **130**, ativa). Heurística de valor do
  PDF **superada** (nota histórica mantida). `classificacao-juros-desconto` saiu de **STUB → draft**;
  `VariacaoCambial`/`calcularVariacaoCambial` desbloqueados. **Resolve também P1-2.**
- **P0-3 (filtro "Adiantamento=SIM") — RESOLVIDO.** Eleição = `listFinanceiroAPagar(PROFORMA)`
  (`tpdCod=99`, `FINALIZADO`) **+ filtro booleano `adiantamento=SIM`** (3 filtros + Plano
  Financeiro vazio, por screenshot). Caminho `tpdCod=143`/`gerNum=198` **descartado**. Literal da
  chave wire = **build-probe**.
- **P0-6 + P0-5 — RESOLVIDO.** "INVOICE casada" = **exatamente 1 invoice FINALIZADA** no processo.
  **Fatia 1 só 1:1**; **N:M** (frequente) → **backlog** (`bloqueada`/`composto-nm`). `PermutaCandidata`
  mantém shape 1:1. Taxonomia de motivos adicionada ao estado `bloqueada`: `composto-nm`,
  `sem-invoice`, `multiplas-invoices`, `falha-gate`, `data-base-indisponivel`.
- **P0-7 — RESOLVIDO.** Query lista **TODAS** via os 3 filtros, depois elege; **sem janela
  incremental**; **multi-filial**; rate-limit = nota de implementação.
- **P0-8 — RESOLVIDO.** Aging conta da **DATA-BASE** (CI da D.I `imp019` / desembaraço da DUIMP
  `imp223`). `aging-anchor` saiu de **STUB → draft**. **Coluna aging gated no probe P0-4.**
- **P0-4 — CONTINUA ABERTO (único).** Vira **probe de diagnóstico**: nomes dos campos wire da
  data-base não conhecidos. Gate 4 valida existência/XOR hoje; a **extração** da data fica pendente.
- Stubs: **2 → 0** (ambas business-rules promovidas a draft). P0 abertos: **6 → 1** (só P0-4).

## v0.2.0 (2026-06-17) — primeira modelagem da Frente I (Permutas, Fatia 1)

Feature: `permutas-painel-elegiveis` (painel de pendências elegíveis, READ-ONLY). ADR-0004.

- **Entidades (5):** `Adiantamento`, `Invoice`, `DeclaracaoImportacao`, `VariacaoCambial`,
  `PermutaCandidata`. A `Permuta` **consumada** (escrita `fin010`) **não** nasce aqui — é Fatia 2.
- **Ações (5):** `elegerAdiantamentos`, `avaliarElegibilidade` (4 gates), `casarInvoice`,
  `calcularVariacaoCambial`, `exporNoPainel`. Todas leitura/cálculo (zero escrita, I4).
- **Máquina de estado (1):** `elegibilidade-permuta-candidata` (`descoberta → elegivel | bloqueada`;
  `executada` é Fatia 2, fora de escopo).
- **Business-rules (4):** `elegibilidade-permuta` (I3), `di-xor-duimp` (I2), e dois **STUBs**
  bloqueados — `classificacao-juros-desconto` (`P0-1`, registra as 2 heurísticas do PDF sem chutar
  fórmula) e `aging-anchor` (`P0-8`).
- **Integração (1):** `conexos` lado-LEITURA (`com298`, `imp019`/`imp223`, `com308`); `fin010`
  (escrita) explicitamente fora de escopo. Re-introduz reads D.I/DUIMP podados no ADR-0003 (O3).
- **6 gaps P0 abertos** no interview — `TaskScoper` não fecha critérios de cálculo/eleição/data-base/
  casamento/aging até o Yuri responder (P0-1, P0-3, P0-4, P0-6, P0-7, P0-8).

## v0.1.0 (2026-06-10) — bootstrap

- Estrutura criada a partir do template `fechamento-processos` (v0.10.2).
- Carregado apenas o **charter** (P1-P7 / I1-I6), a estrutura de pastas e o design profile.
- Domínio **vazio por design**: entidades, ações, regras, integrações, ui-flows e workflows
  serão modelados incrementalmente via o pipeline (`/feature-new`).
- `_index.json` / `_coverage.json` zerados.

## Roadmap (pós-bootstrap)

1. `/feature-new` da primeira entidade do domínio financeiro (interview profundo, 4 axes).
2. (Re)documentar o contrato da integração Conexos em `ontology/integrations/conexos.md`
   — o código (`ConexosClient`) já está conectado; a ontologia está vazia.
