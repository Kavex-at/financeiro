---
name: conexos
type: integration
direction: read-write (read amplo Permutas+SISPAG + write-back fin010 gated; SISPAG READ-only)
ontology_version: "0.5"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosClient.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/service/permutas/BorderoGestaoService.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/migrations/0017_invoice_importador.sql
  - src/backend/migrations/0018_permuta_bordero_cache.sql
  - src/backend/migrations/0019_permuta_perf_indexes.sql
last_review: 2026-07-07
endpoints_read:
  - com298 (PROFORMA tpdCod=99 + docVldTipoAdto=1 / INVOICE tpdCod=128 / detail mnyTitPermutar + pago=mnyTitAberto===0)
  - imp019 (D.I — data CI = cdiDtaCi)
  - imp223 (DUIMP — data desembaraço = dioDtaDesembaraco)
  - com308 (título a-pagar — taxa/valor negociado; SISPAG: alçada titVld1/2/3libera)
  - "fin064 (SISPAG — carteira de pagamentos; ConexosSispagClient READ-only)"
  - "fin015 (SISPAG — lotes nativos, contexto; ConexosSispagClient READ-only)"
  - "fin010 (SISPAG — borderôs a-pagar, contexto; ConexosSispagClient READ-only)"
endpoints_write:
  - fin010 (Permutas: write-back Fase 3, gated / SISPAG: FORA DE ESCOPO)
  - "fin015 gerar remessa + fin052 retorno (SISPAG WRITE — FUTURO/gated, próxima fatia)"
resolved-by:
  - "P0-3 — caminho = listFinanceiroAPagar(PROFORMA) + filtro docVldTipoAdto=1 (FinDocCab); chave wire confirmada por probe de rede (dev tenant Columbia, 2026-06-18, filCod=2, 410 adiantamentos reais)"
  - "P0-4 — campos wire da data-base RESOLVIDOS: cdiDtaCi (imp019, D.I) / dioDtaDesembaraco (imp223, DUIMP); probe de rede 2026-06-18; XOR confirmado em dados reais"
  - "P0-7 — query lista TODAS via 3 filtros; sem janela incremental; multi-filial; rate-limit é nota de impl (Yuri, 2026-06-17)"
  - "gate-3-pago-via-detail — RESOLVIDO (probe de rede 2026-06-18, 408 detalhes): pago ⟺ mnyTitAberto === 0 (estrito); hidratado via getDetalheTitulos na mesma chamada do Gate 2"
open-gap:
  - "residual-pago-centavos (P2) — doc 8721 tem aberto=0,02 em título ~R$20M; Gate 3 estrito bloqueia. Confirmar c/ analistas se resíduo de centavos = totalmente pago e qual o teto"
  - "vc-permuta-parcial (Fatia 2) — variação cambial em permutas parciais deve usar o valor PARCIAL (mnyTitPermutar literal), não o integral do título"
---

# Integração: Conexos ERP (lado-LEITURA — Permutas Fatia 1)

> Contrato de **leitura** consumido pela Frente I, Fatia 1 (painel READ-ONLY). Reusa o
> `ConexosClient` já validado (mesmo tenant do `fechamento-processos`, `priCod=1153`).
> **Sem escrita** (`fin010` fora de escopo). Esta fatia **re-introduz** reads de D.I/DUIMP
> que o ADR-0003 podou (ver ADR-0004 e migration-debt O3).

## Endpoints de leitura

| Endpoint | Uso | Método `ConexosClient` | Wire | Notas |
|----------|-----|------------------------|------|-------|
| `com298/list` | PROFORMA finalizado (Adiantamento) | `listFinanceiroAPagar({docTip:'PROFORMA'})` + filtro `docVldTipoAdto=1` | `tpdCod=99`, `vldStatus=['3']`, `docVldTipoAdto=1` (FinDocCab) | **P0-3 RESOLVIDO (probe 2026-06-18):** 3 filtros (Adiantamento=SIM + Tipo=PROFORMA + Situação=FINALIZADO, Plano Financeiro VAZIO). Chave wire = `docVldTipoAdto=1`. |
| `com298/list` | INVOICE finalizada | `listFinanceiroAPagar({docTip:'INVOICE'})` | `tpdCod=128`, `vldStatus=['3']` | Casamento por `priCod`. |
| `GET com298/{docCod}` | `mnyTitPermutar` (saldo) **+** status pago **+** face/saldo-aberto | `getDetalheTitulos({docCod})` → `{ valorPermutar?, pago?, valorPermutado?, valorTotal?, valorAberto? }` | detail; todos `null` no list | Gate 2 (`valorPermutar > 0`) **e** Gate 3 (`pago`). `valorTotal` (`mnyTitValor`) + `valorAberto` (`mnyTitAberto`) → **progresso de pagamento** (% pago + quanto falta) dos bloqueados por `nao-pago` (ADR-0006, read-only). Uma única chamada de detalhe por candidato. |
| `GET com298/{docCod}` (detail) | status TOTALMENTE PAGO (Gate 3) | `getDetalheTitulos` → `pago = (mnyTitAberto === 0)` | `mnyTitAberto`/`mnyTitPago`/`mnyTitValor` = `null` no list, populados no detail | **RESOLVIDO (probe 2026-06-18):** `pago ⟺ mnyTitAberto === 0` (estrito). Confirmado nos dois polos (26471 NÃO PAGO `aberto=384119.95`; 24166 PAGO `aberto=0`). |
| `imp019/list` | D.I — **data CI** (data-base) | re-introduzido; `mapDeclaracaoDataBase` | `cdiDtaCi` (epoch-ms); acompanha `cdiEspNumci` (nº CI) | **P0-4 RESOLVIDO (probe 2026-06-18).** Campo wire confirmado. |
| `imp223/list` | DUIMP — **data de desembaraço** (data-base) | re-introduzido; `mapDeclaracaoDataBase` | `dioDtaDesembaraco` (epoch-ms) | **P0-4 RESOLVIDO (probe 2026-06-18).** Campo wire confirmado. |
| `com308/financeiroAPagar/list/{docCod}` | taxa/valor negociado | `listTitulosAPagar({docCod})` | `titFltTaxaMneg`, `titMnyValorMneg`, `moeCodMneg`, `moeEspNome`, `titMnyValor`; `serviceName='com308.finTituloFin'` | Entrada da `VariacaoCambial` (fórmula = comparação de TAXA, P0-1 RESOLVIDO). |
| `com298/list` (universo) | **TODAS** as invoices finalizadas da filial | `listInvoicesFinalizadas({filCod})` | `tpdCod=128`, `vldStatus IN finalizado` | **ADR-0014:** universo completo (não só casadas) p/ busca/contagem por cliente. Cap-hit de paginação logado (Regis 2026-06-24-2011, Integrability P1). `ConexosClient.ts:709+`. |
| `imp021/list` | importador (cliente) do processo | `listProcessos(...)` | `pesCod` + nome importador | **ADR-0014:** hidrata `pes_cod`/`importador` em TODAS as invoices (migration `0017`). `ConexosClient.ts:467+`. |
| `fin010/list` (`borVldTipo=2`) | borderôs de **permuta** | `listBorderos({filCod, borCods?, pageSize?})` | `borCod`, `borVldFinalizado`, `borCodEstornado`, `vlrTotalLiquido`, `borDtaMvto`, `usnDesNomeCad` | **ADR-0014:** alimenta o cache `permuta_bordero` + status PERMUTA→BORDERÔ (busca precisa por `borCod#IN`). `ConexosClient.ts:1301+`. `requireRole('admin')`. |
| `fin010/baixas/list/{borCod}` | baixas de um borderô (lado-invoice) | `listBaixas({filCod, borCod})` | `docCod`, `docTip`, `titCod`, `bxaCodSeq`, `bxaMnyLiquidoPermuta` | **ADR-0014:** detalhe de borderôs lançados direto no Conexos (sem trilha). `ConexosClient.ts:1155+`. |

## Constantes de tenant (Columbia, priCod=1153)

- `tpdCod`: 99 (PROFORMA), 128 (INVOICE). `tpdCod=143` (IMPLANTAÇÃO SALDO) era o caminho
  alternativo do P0-3 — **descartado** (caminho correto é PROFORMA + filtro `docVldTipoAdto=1`).
- `docVldTipoAdto`: `1` = adiantamento (modelo `FinDocCab`). Chave wire confirmada por probe
  (2026-06-18). Plugado em `conexosPermutasConstants.ts`.
- `gerNum`: 198 (ADTO FORNECEDOR INTERNACIONAIS — confirmado nos 410 reais carregando
  `docVldTipoAdto=1` / `gcdDesNome="ADIANTAMENTO PROFORMA"`), 210/233 — não usados como *caminho* de
  eleição (path `gerNum` descartado por P0-3); mantidos como referência de catálogo de tenant.
- `vldStatus`: `'3'` = FINALIZADO.
- **P6 / Inviolable Rule #2:** estes IDs são da instalação Columbia — manter como **constantes
  tipadas**, nunca hardcode de tenant em service. Outra trading (outro `priCod`) recalibra os IDs.

## Estado dos gaps

- **P0-3 — RESOLVIDO (probe de rede 2026-06-18).** Caminho = `listFinanceiroAPagar({docTip:'PROFORMA'})`
  + filtro **`docVldTipoAdto=1`** (FinDocCab) (3 filtros: Adiantamento=SIM + Tipo=PROFORMA +
  Situação=FINALIZADO; Plano Financeiro VAZIO). Caminho `listAdiantamentoFinanceiroAPagar`/`tpdCod=143`/`gerNum=198`
  (path) **descartado**. O placeholder anterior (`adiantamento#EQ`/`'S'`) era um **BUG** (HTTP 500
  `adiantamento (FinDocCab)`, campo inexistente). **Não é mais build-probe.**
- **P0-4 — RESOLVIDO (probe de rede 2026-06-18).** Campos wire de data-base: `cdiDtaCi` (`imp019`,
  D.I, data CI, epoch-ms; acompanha `cdiEspNumci`) e `dioDtaDesembaraco` (`imp223`, DUIMP, epoch-ms).
  XOR DI/DUIMP confirmado em dados reais. Plugado em `ConexosClient.mapDeclaracaoDataBase`. A coluna
  aging agora popula. **Não é mais `blocked-by`.**
- **P0-7 — RESOLVIDO.** Query lista **todas** via os 3 filtros, depois elege; **sem janela
  incremental**; multi-filial. Rate-limit (`PAGE_SIZE=500`, `MAX_PAGES=50`, paginate cap
  existente) é **nota de implementação não-bloqueante**.
- **`gate-3-pago-via-detail` — RESOLVIDO (probe de rede 2026-06-18, varredura de 408/411 detalhes).**
  Status TOTALMENTE PAGO vem `null` no `com298/list`; mora no **detalhe** `GET /com298/{docCod}`.
  Regra: `pago ⟺ mnyTitAberto === 0` (estrito). Hidratado via `getDetalheTitulos` na **mesma**
  chamada de detalhe do Gate 2 (zero fan-out novo). `EleicaoPermutasService.buildCandidata` injeta
  `pago` no adiantamento antes de `avaliarElegibilidade`.

## Detalhe `com298/{docCod}` — agregados de títulos (probe 2026-06-18, 408 docs)

Campos do bloco **RESUMO DOS TÍTULOS** (todos `null` no `com298/list`, populados só no detalhe):
`mnyTitValor` (Valor dos Títulos), `mnyTitPago` (Valor Pago), `mnyTitAberto` (Valor em Aberto),
`mnyTitPermuta` (Valor **já** Permutado), `mnyTitPermutar` (Valor **a** Permutar / saldo).

**Identidade universal (0 violações em 408 docs):** `mnyTitValor = mnyTitPago + mnyTitAberto`.
⇒ funda o Gate 3 (`mnyTitAberto === 0` ⟺ totalmente pago).

**`mnyTitPermutar` é AUTORITATIVO — nunca derivar.** A aproximação `permutar ≈ mnyTitPago − mnyTitPermuta`
vale na maioria (ex.: doc 8520 `17.560.450,75 − 17.554.893,33 = 5.557,42` exato), mas **quebra** em
**permutas parciais**: adiantamento totalmente pago (`aberto=0`) que usará apenas valor **parcial** na
baixa/borderô. Reais: `3334` (pago=permutar? não: pago=462.227,29, permutar=168.052,99) e `11808`
(pago=193.460,42, permutar=1.672,99). **A Fatia 2 (baixa/`fin010`) deve usar o `mnyTitPermutar` LITERAL**,
nunca reconstruir de pago/permuta. **⚠️ Variação cambial:** calcular sobre o valor **parcial** efetivamente
permutado, não sobre o valor integral do título — risco em permutas parciais.

> **Terminologia (não confundir):** "permuta **parcial**" aqui = um adiantamento totalmente pago cujo
> `mnyTitPermutar` é menor que o valor integral (usa-se só parte do saldo na baixa). É o que está
> confirmado nos reais (3334, 11808). As regras de **permutagem múltipla** (1 adiantamento ↔ N invoices
> e variantes) são **distintas e ainda NÃO modeladas** — serão definidas em feature própria.

**Confirmação dos gates (dado real):** Gate 2 ⊋ Gate 3 — doc `21841` (pago=44.917,24, **aberto=1.621,34**,
permutar=44.917,24) passa Gate 2 mas **falha** Gate 3 (parcialmente pago). Os dois gates são necessários;
Gate 3 é o estrito. Distribuição: 70 NÃO PAGO · 332 TOTALMENTE PAGO · 6 PARCIALMENTE PAGO · 42 com permuta.

**Anomalia em aberto (`residual-pago-centavos`):** doc `8721` tem `aberto=0,02` em título de `~R$20M`
(`permutar=0`). Hoje o Gate 3 estrito o **BLOQUEIA**. Pendente: confirmar com os analistas se um resíduo
de centavos conta como TOTALMENTE PAGO e qual o teto de "residual". Ver follow-up no inbox.

## ESCRITA — `fin010` baixa/permuta (Fase 3, ADR-0013)

A **primeira escrita** do sistema no Conexos. Contrato completo (endpoints, payloads, mapeamento) em
`business-rules/fin010-write-contract.md`; idempotência/fault-tolerance em
`business-rules/idempotencia-reconciliacao.md`. Não é um POST único — é um **handshake de 5 chamadas**
(todas `POST`, base `/api`):

| # | Endpoint | Papel |
|---|----------|-------|
| 1 | `POST /api/fin010` | cria o borderô → retorna `borCod` |
| 2 | `POST /api/fin010/baixas/validacao/tituloBaixa` | valida a invoice → ERP devolve `bxaMnyValor` (em-aberto vivo) |
| 3 | `POST /api/fin010/baixas/validacao/tituloPermuta` | valida o adiantamento → dados da permuta |
| 4 | `POST /api/fin010/baixas/validacao/atualizaValorLiquido` | recalcula líquido com o juros |
| 5 | `POST /api/fin010/baixas` | **grava** a baixa/permuta → `bxaCodSeq` (confirmação) |

- **Reuso da infra de leitura:** `ConexosClient.{criarBordero,validarTituloBaixa,validarTituloPermuta,
  atualizarValorLiquido,gravarBaixaPermuta}` → `postGeneric` → `authenticatedPost` (sid + `cnx-filcod` +
  `cnx-usncod` + retry-em-401). Mesmo `RetryExecutor`, mesmo `ConexosError`.
- **Guard-rails:** `CONEXOS_WRITE_ENABLED` (default false) + `CONEXOS_DRY_RUN` (default true);
  **homologação-first** (`CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud`, mesmas
  credenciais/`filCod`). Dry-run monta/loga o payload sem POST.
- **Conta de juros = 131** (VARIAÇÃO CAMBIAL PASSIVA REALIZADA); o ERP é a fonte da verdade do valor
  (`bxaMnyValor` do passo 2), nunca o nosso `valor_alocado` (anti-super-pagamento).

### Ainda não observado no ERP (follow-up)
- Baixa **parcial** (invoice compartilhada N:M); finalização do borderô (`borVldFinalizado`); caminho
  `DESCONTO` (conta gerencial 94). O HAR cobriu 1 adto → 1 invoice cheia, classificação `JUROS`.

### Contrato de leitura de ERRO — `Generic.ERROR_MESSAGE` / `vars.msg`
Os erros do `fin010`/`fin014` voltam no envelope `{ messages: [{ valid?, message, vars? }] }`. **`message`
é a KEY** (ex.: `FIN_010.DATA_BLOQUEADA_PELA_CONTABILIDADE`). Quando a key é o envelope genérico
**`Generic.ERROR_MESSAGE`**, a **razão real fica em `vars.msg`** (ex.: `"CONTA DE DESCONTO NÃO
INFORMADA!!!"` — ver `fin010-write-contract.md` §"Resolvido em campo (2026-06-25)", borderô 14918). Ler só
`messages[0].message` deixa o usuário com um texto genérico (caixa-preta).

**Fonte única de tradução:** `ErpErrorInterpreter`
(`src/backend/domain/service/permutas/ErpErrorInterpreter.ts`, `@singleton`). Prioridade da mensagem:
razão real (`vars.msg` do Generic) → tradução PT curada por key → key crua → `Error.message`. Guardas:
`vars.msg` só conta se string não-vazia; prefere a mensagem `valid==='ERRO'`. É o ponto único usado pelos
3 caminhos que traduziam erro do ERP (ações do borderô em `routes/permutas.ts`; `friendlyErpMessage` e
`assertNoErpError` em `ReconciliacaoPermutaService`). A resposta HTTP das ações leva a razão real em
`error`/`erpDetail`; o envelope cru continua logado (`erpData`). O `vars.msg` é texto operacional do ERP —
sid/token vivem no header `Cookie`, não em `response.data`, então surface é seguro.

## Cache local de borderôs — `permuta_bordero` (ADR-0014, v0.7.0)

Para a aba Borderôs não bater no ERP a cada abertura, os borderôs de permuta (`fin010` `borVldTipo=2`)
são cacheados na tabela própria **`permuta_bordero`** (migration `0018_permuta_bordero_cache.sql`):
campos crus do ERP (`bor_cod` PK, `fil_cod`, `bor_vld_finalizado`, `bor_cod_estornado`,
`vlr_total_liquido`, `bor_dta_mvto`, `usn_des_nome_cad`, `atualizado_em`). A **situação** (em
cadastro/finalizado/cancelado/estornado) é **derivada na leitura** (`situacaoDoItem`,
`BorderoGestaoService.ts:496-504`), não persistida.

- **Populado** na ingestão e pelo botão "Atualizar" → `BorderoGestaoService.refreshCache`
  (`:381-418`, varre todas as filiais via `listBorderos`, dedup por `borCod`).
- **Lido** pela tela: `GET /permutas/borderos` (`routes/permutas.ts:423-433`), LIMIT 500 mais recentes;
  `?live=true` força refresh ao vivo antes de ler (`listarBorderos`, `:295-356`).
- **Ações** de borderô atualizam o cache na hora (`updateBorderoCacheSituacao`/`deleteBorderoCache`).
- **Índices** do hot path em migration `0019_permuta_perf_indexes.sql`
  (`permuta_bordero` por `bor_dta_mvto DESC, bor_cod DESC`; `permuta_alocacao_execucao(bor_cod)` parcial)
  — Regis-Review 2026-06-24-2011, Performance P1.

> O cache é **leitura derivada do ERP**, não fonte da verdade: o `fin010` continua autoritativo; o
> cache só acelera a listagem (`READ`). As escritas (finalizar/cancelar/excluir baixa) seguem o
> handshake gated e refletem no cache de imediato.

## SISPAG (Escopo II) — superfície de LEITURA (`ConexosSispagClient`, ADR-0015)

> Contrato de **leitura** consumido pela Frente II, Fatia 1+2 (painel read-only + montagem de lote +
> gate). Isolado num client próprio **`ConexosSispagClient`** (separa a superfície SISPAG do
> `ConexosClient` de Permutas). **READ-only nesta fatia** (I1) — nenhum verbo mutante importado.
> A superfície de **ESCRITA** (`fin015` gerar remessa / `fin052` retorno / `fin010` baixa) é
> **futura/gated** (próxima fatia — transporte pasta de rede + VAN Nexxera; ver ADR-0015).

| Endpoint | Uso | Método `ConexosSispagClient` | Wire | Notas |
|----------|-----|------------------------------|------|-------|
| `fin064/list` | **carteira de pagamentos** (TituloAPagar) — a vencer + vencidos | `listTitulosAPagar({filCod, janela})` | `docCod`, `titCod`, `filCod`, credor, `titMnyValor`, `titDtaVencimento`, `bncCod`/`ccoCod`, `conVldEnviaNexxera`, `enviadoBanco`, `titNumRemessa`, `borCod` | **READ.** Base do painel diário (2.100 fil1 / 18.234 fil2 reais). Janela −15d..+45d. |
| `com308/.../list/{docCod}` | **alçada de liberação** (`liberado`) + detalhe do título | `getAlcadaTitulo({docCod})` (ou hidratado na carteira) | `titVld1libera`/`titVld2libera`/`titVld3libera` (+`Tim/Usn/usnDesNomel`), `titVldEnviaBanco`, `vldBordero`, `titVldStatus` | **READ.** `liberado = AND das flags de alçada`. "Aprovado para baixa" (Escopo II). Ver `elegibilidade-titulo-lote`. |
| `fin015/list` | **lotes SISPAG nativos** (contexto do painel) | `listLotesSispag({filCod?})` | `FinLoteSispag`: `bncCod`, `ccoCod`, `layoutConta`, `flpVldConfEnvio`, `soma`, analista | **READ (contexto).** 17 lotes reais (Itaú/Santander). NÃO participam do nosso ciclo de vida de lote candidato. |
| `fin010/list` (a-pagar) | **borderôs a-pagar** (contexto do painel) | `listBorderosAPagar({filCod?})` | `borCod`, `borVldTipo`, `borVldFinalizado`, `vldHasRemessaPgto` | **READ (contexto).** A baixa via borderô é o mecanismo massivo (`vldHasRemessaPgto≈0` em ~99% — baixa direta). |

- **I1 (read-only):** o `ConexosSispagClient` **não importa** nenhum verbo de escrita nesta fatia.
  Toda escrita da fatia é **local** (`lote_pagamento`/`lote_pagamento_item`).
- **Reuso da infra:** mesmo padrão de auth (sid + `cnx-filcod` + `cnx-usncod`), `RetryExecutor` e
  Zod/guard nos boundaries do `ConexosClient` de Permutas; SSM em prod.
- **Constantes de tenant:** IDs de banco/conta/layout (Itaú 341, Santander 33, `layoutConta`) e
  níveis de alçada são da instalação Columbia — constantes tipadas, nunca hardcode em service
  (Inviolable Rule #2). Outra trading recalibra.

### ESCRITA SISPAG — FUTURO/gated (fora de escopo, ADR-0015)

`fin015` (montar/finalizar lote nativo + `gerArquivosBancos/gerarRemessa` → `PG*.REM`), `fin052`
(carregar/processar retorno) e a baixa `fin010` são o **motor nativo** que a próxima fatia vai
**dirigir** (não reconstruir). O gap real é o **transporte** (passos 6–7: entregar a remessa ao banco
e trazer o retorno) — sem endpoint nativo; alvo = pasta de rede + VAN Nexxera. Gate: contrato Nexxera
cobrir pagamento (Ricardo→Nexxera). A escrita reusará o gating de Permutas (`CONEXOS_WRITE_ENABLED` +
`CONEXOS_DRY_RUN`, homologação-first). Riscos O4 (scheduler) e O7 (config Nexxera) abertos.

## FRENTE IV (Recebimentos) — superfícies NOVAS (SKELETON, ADR-0022)

> **SKELETON (Fase 0).** A Frente IV (Conciliação de Recebimentos) adiciona ao Conexos **duas
> superfícies novas**: (1) **leitura** dos recebíveis em aberto (`DocumentoAReceber`) e (2) **escrita**
> — a **baixa/quitação do recebível** (write O3) + a **emissão da NDe** (Nota de Débito Eletrônica). O
> import do extrato bancário **NÃO** passa por aqui — é direto do Nexxera (ver `integrations/nexxera.md`).
> Contratos concretos confirmados nas Fases 2/5. Ver ADR-0022.

### LEITURA — recebíveis em aberto (`DocumentoAReceber`, Fase 2)

- Read-model de **contas a receber** (documento/título, cliente/`pesCod`, valor, saldo em aberto,
  vencimento, nº documento, `priCod`). **Fonte exata no ERP a confirmar na Fase 2** (o plano assume o
  caminho de leitura financeira do Conexos, a parametrizar — espelha a leitura SISPAG `ConexosSispagClient`
  READ-only). Ver `entities/documento-a-receber.md`.

### ESCRITA — baixa/quitação do recebível (write O3, Fase 5)

- **Decisão O3 (interview):** **assume o módulo `fin010`** e **parametriza** o write. Os campos
  hoje **específicos de Permuta** — `borVldTipo`, códigos de conta, o flag de adiantamento — viram
  **parâmetros** (recebível vs permuta). A **maquinaria reusável** do handshake `fin010` de Permutas
  **carrega** (write-ahead ledger, escrita single-attempt, anti-drift, dry-run gate); o **shape do
  payload/endpoint** do lado recebível é **confirmado durante o build** (capturar uma baixa real de
  recebível se a aposta parametrizada não fechar).
- **Reúso da infra:** mesma cadeia `ConexosBaixaClient`/`postGeneric → authenticatedPost` (sid +
  `cnx-filcod` + `cnx-usncod` + retry-em-401), mesmo `RetryExecutor`, mesmo `ConexosError`. Mesmo
  gating: `CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN` (default dry-run), **homologação-first**.
- Contrato de escrita completo: `business-rules/fin010-write-contract.md` (Permutas) é o **template**;
  a variante parametrizada de recebível é fatia própria da Fase 5. Idempotência em
  `business-rules/idempotencia-quitacao-nde.md`.

### ESCRITA — emissão da NDe (Fase 5)

- A **Nota de Débito Eletrônica é emitida pelo Conexos ERP** (decisão Yuri, 2026-07-24) — **não** é
  sistema fiscal separado nem auto-gerada. Precisa do **endpoint/trigger de emissão** no Conexos
  (confirmar **junto do O3**, Fase 5). A emissão é **idempotente** (uma NDe por `Recebimento`, via
  `idempotencyKey`) e o registro local existe só para idempotência/auditoria (fonte da verdade = ERP).
  Ver `entities/nota-debito-eletronica.md` e `business-rules/idempotencia-quitacao-nde.md`.
- **Alternativa considerada e rejeitada (Fase 0):** um `integrations/nde-conexos.md` separado. A NDe é
  emitida **pelo mesmo ERP** (Conexos) — modelá-la como superfície de escrita do Conexos (como a baixa
  `fin010`) mantém a convenção de "uma integração por sistema externo". Registrado na ADR-0022.
