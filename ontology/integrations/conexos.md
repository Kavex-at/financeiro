---
name: conexos
type: integration
direction: read-write (read amplo Permutas+SISPAG + write-back fin010 gated; SISPAG escreve fin015/fin052 e, ADR-0077 implemented, borderô fin010 do boleto agrupado)
ontology_version: "0.48.0"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosClient.ts
  - src/backend/domain/client/ConexosSispagClient.ts
  - src/backend/domain/client/ConexosTitulosClient.ts
  - src/backend/domain/client/ConexosSispagRetornoClient.ts
  - src/backend/domain/service/permutas/BorderoGestaoService.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/migrations/0017_invoice_importador.sql
  - src/backend/migrations/0018_permuta_bordero_cache.sql
  - src/backend/migrations/0019_permuta_perf_indexes.sql
last_review: 2026-10-21
endpoints_read:
  - com298 (PROFORMA tpdCod=99 + docVldTipoAdto=1 / INVOICE tpdCod=128 / detail mnyTitPermutar + pago=mnyTitAberto===0)
  - imp019 (D.I — data CI = cdiDtaCi)
  - imp223 (DUIMP — data desembaraço = dioDtaDesembaraco)
  - com308 (título a-pagar — taxa/valor negociado; SISPAG: alçada titVld1/2/3libera)
  - "fin064 (SISPAG — carteira de pagamentos; ConexosSispagClient READ-only)"
  - "fin015 (SISPAG — lotes nativos, contexto; ConexosSispagClient READ-only)"
  - "fin010 (SISPAG — borderôs a-pagar, contexto; ConexosSispagClient READ-only)"
endpoints_write:
  - "fin010 (Permutas: write-back Fase 3, gated / SISPAG: só o borderô do boleto agrupado, ver abaixo)"
  - "fin010 (SISPAG — borderô do boleto agrupado, WRITE, ADR-0077 implemented)"
  - "fin015 borderosPendentes list/importar (WRITE, ADR-0077 implemented)"
  - "fin015 gerar remessa + fin052 retorno (SISPAG WRITE — FUTURO/gated, próxima fatia)"
resolved-by:
  - "P0-3 — caminho = listFinanceiroAPagar(PROFORMA) + filtro docVldTipoAdto=1 (FinDocCab); chave wire confirmada por probe de rede (dev tenant Columbia, 2026-06-18, filCod=2, 410 adiantamentos reais)"
  - "P0-4 — campos wire da data-base RESOLVIDOS: cdiDtaCi (imp019, D.I) / dioDtaDesembaraco (imp223, DUIMP); probe de rede 2026-06-18; XOR confirmado em dados reais"
  - "P0-7 — query lista TODAS via 3 filtros; sem janela incremental; multi-filial; rate-limit é nota de impl (Yuri, 2026-06-17)"
  - "gate-3-pago-via-detail — RESOLVIDO (probe de rede 2026-06-18, 408 detalhes): pago ⟺ mnyTitAberto === 0 (estrito); hidratado via getDetalheTitulos na mesma chamada do Gate 2"
  - "residual-pago-centavos — RESOLVIDO p/ o ADIANTAMENTO (ADR-0046, 2026-09-14): o pago do wire segue estrito (mnyTitAberto === 0); a regra de domínio do Gate 3 é |mnyTitAberto| ≤ R$1,00 e a do Gate 2 é mnyTitPermutar > R$1,00. Invoice.pago e títulos SISPAG seguem estritos"
  - "invoice-pago-via-titulo — RESOLVIDO (sonda probe-invoice-pago, PRD filial 2, 2026-08-28): o com298/list também não popula saldo no lado INVOICE (mnyTitAberto null em 1146/1146); o pago da invoice passa a sair de titMnyTotPago no com308 (0 chamadas extras), derivação validada 30/30 contra o detalhe"
open-gap:
  - "com308-enum-pago (P3) — o com308 expõe um campo `pago` que NÃO é booleano (valores 1/2/3 observados: 21/2/7 numa amostra de 30). Significado de cada valor não decodificado; a derivação em uso é a identidade monetária, provada. Decodificar simplificaria a soma"
  - "vc-permuta-parcial (Fatia 2) — variação cambial em permutas parciais deve usar o valor PARCIAL (mnyTitPermutar literal), não o integral do título"
---

# Integração: Conexos ERP (lado-LEITURA — Permutas Fatia 1)

> Contrato de **leitura** consumido pela Frente I, Fatia 1 (painel READ-ONLY). Reusa o
> `ConexosClient` já validado (mesmo tenant do `fechamento-processos`, `priCod=1153`).
> **Sem escrita** (`fin010` fora de escopo). Esta fatia **re-introduz** reads de D.I/DUIMP
> que o ADR-0003 podou (ver ADR-0004 e migration-debt O3).

## Identidade da sessão — robô vs. usuário vinculado (Fatia B, ADR-0041)

Toda chamada ao Conexos sai sob **uma** identidade do ERP, decidida **por request** pelo
`ConexosSessionResolver`:

| Situação | Sessão usada | Chave em `conexos_sessions` |
|----------|--------------|------------------------------|
| Request de usuário com vínculo Conexos válido | a dele | `columbia:user:<login>` |
| Sem request (job/cron/script) | robô (`CONEXOS_USERNAME`) | `columbia-default` |
| Usuário sem vínculo | robô | `columbia-default` |
| Senha do vínculo não decifra | robô (**loga `warn`**) | `columbia-default` |
| Login Conexos do usuário falha | robô (**loga `warn`**) | `columbia-default` |

A identidade viaja para o ERP como o cookie `sid` + o header `cnx-usncod`, ambos capturados no
`POST /login` **daquela** sessão — logo, trocar a sessão troca de verdade a autoria da escrita no
Conexos, sem mudar nenhum sub-client.

**Diagnóstico rápido:** a existência de uma linha `columbia:user:<login>` em `conexos_sessions` é a
prova de que aquele vínculo já logou com sucesso. Ausência = nunca logou → aquele usuário está
operando pelo robô. `GET /me/conexos-status` dá o veredito direto (`ok` / `falha` / `ausente`).

Ver `business-rules/identidade-execucao-conexos.md` para os invariantes de log (I-1) e de
registro no ledger (I-2).

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

- **`invoice-pago-via-titulo` — RESOLVIDO (sonda `probe-invoice-pago`, PRD filial 2, 2026-08-28).**
  A evidência de 2026-06-18 media **PROFORMAs** (411 docs) e foi generalizada para "o list não traz
  saldo" sem nunca ter sido medida no lado **INVOICE**. Medido agora: `mnyTitAberto`, `mnyTitPago` e
  `mnyTitValor` vêm `null` em **1146/1146** INVOICEs finalizadas da filial 2, e o campo `pago` sequer
  existe na row. Logo `isPago(row)` devolvia `false` para **todas**, e o filtro
  `permuta_invoice WHERE NOT pago` da aba "Invoices em aberto" era **no-op**.
  Fonte adotada: **`titMnyTotPago` do `com308/financeiroAPagar/list/{docCod}`** — aceito no
  `fieldList` explícito e obtido na chamada que a ingestão **já fazia** para valor/taxa negociada
  (custo zero). Regra: `pago ⟺ Σ titMnyValor − Σ titMnyTotPago === 0` (estrita), validada contra o
  detalhe como ground truth: **30/30, zero divergências**.

## `com298/list` — o que o list NÃO entrega (medido, não suposto)

- Os agregados de título (`mnyTitValor`/`mnyTitPago`/`mnyTitAberto`/`mnyTitPermutar`) são `null` no
  list para **PROFORMA e INVOICE**. Nunca derive estado de pagamento da row do list.
- `mnyTitAberto` **também não serve como filtro**: `'mnyTitAberto#GT': 0` no `filterList` faz o
  endpoint responder **HTTP 500** (sonda 2026-08-28). A evidência anterior de `ORA-00904` era sobre
  `fieldList`/SELECT; agora está medido que a cláusula de filtro também não aceita. Não há como pedir
  ao ERP "só as invoices em aberto" — o recorte é sempre nosso, depois de ler o título.

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

**`residual-pago-centavos` — RESOLVIDO (ADR-0046, 2026-09-14):** doc `8721` tem `aberto=0,02` em título
de `~R$20M` (`permutar=0`). O `pago` do **wire** continua estrito (`mnyTitAberto === 0`), mas a regra de
**domínio** da elegibilidade do adiantamento passa a ser `|mnyTitAberto| ≤ R$1,00` (Gate 3) e
`mnyTitPermutar > R$1,00` (Gate 2), mesmo teto absoluto da âncora I-Write-6. O 8721 deixa de ser
`nao-pago`. Resíduos reais (≥ R$ 21, ex.: `21841` com 1.621,34) seguem reprovando o Gate 3.

**`mnyTitPermutar` é líquido do que o ERP já abateu (ADR-0046):** o ERP só abate o saldo a permutar
quando o borderô da baixa é **finalizado** (`borVldFinalizado = 1`); em cadastro, cancelado ou
estornado, não. Medido em 128 adtos com execução real (125 abatidos, todos com borderô finalizado).
Consequência para o saldo restante: ver I-Permuta-1 em `entities/permuta.md`.

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

### Classificação da falha — RECUSA × INDISPONIBILIDADE (ADR-0026, v0.13.0)

Ler a razão não basta: é preciso decidir **se retentar**. O status do upstream separa as duas naturezas,
e a separação é feita num ponto único — `ErpResponseReader`
(`src/backend/domain/errors/ErpResponseReader.ts`), usado pelo `ConexosError` **e** pelo
`ErpErrorInterpreter`, para que classificação e tradução nunca discordem sobre o mesmo payload.

| Resposta do ERP | Natureza | `code` do `ConexosError` | `retryable` | HTTP para fora |
|---|---|---|---|---|
| sem resposta (rede/parse/socket) | indisponibilidade | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| 5xx | indisponibilidade | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| 408 · 429 | indisponibilidade | `CONEXOS_UPSTREAM_ERROR` | `true` | 504 |
| demais 4xx | **recusa determinística** | `CONEXOS_UPSTREAM_REJECTED` | **`false`** | **502** |
| timeout declarado pelo caller | indisponibilidade | `CONEXOS_UPSTREAM_TIMEOUT` | `true` | 504 |

Uma **recusa** é veredito do ERP sobre o conteúdo do pedido: repetir devolve a mesma resposta, palavra
por palavra. Por isso ela (a) não é retentada — nem pelo `RetryExecutor` do `ConexosBaseClient`, nem pela
política central do `RecebimentoPipelineService` —, e (b) chega ao analista com a **razão crua do ERP**
(`vars.msg`, senão a key) em vez de "tente novamente em alguns minutos", que seria o conselho errado.

O caso que estabeleceu a regra: `POST /api/fin014/finalizar/{borCod}` devolvendo
`400 CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` no HML — defeito de ambiente do lado da Conexos,
determinístico, medido em `docs/e2e/fin014-finalizacao-hml-diagnostico.md`.

**Não confundir com idempotência:** uma escrita irreversível continua sendo tentativa única
(`postGenericOnce`), retentável ou não.

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
| `fin064/list` filtrado por `docCod` | **situação de pagamento** de um título de lote (L11, ADR-0055) | `ConexosSispagClient.getTituloAPagar(filCod, docCod, titCod)` | `vldPago`, `aberto` | **READ.** **Sem** `vldPago#EQ: 0` (≠ carteira). Prova de pagamento: `vldPago = 1 ∧ aberto = 0`. Campo ausente/ilegível **não** é coagido a `false` (I11c). |
| `com308/financeiroAPagar/baixas/list/{docCod}/{titCod}/0` | **baixas do título**: borderô, `bxaCodSeq`, data, usuário (PSQ_018, `cpoCod` 815) | `ConexosTitulosClient.listBaixasTitulo({docCod, titCod, filCod})` | `borCod`, `bxaCodSeq`, data e usuário da baixa | **READ, enriquecimento.** Filtra `borVldFinalizado#IN [1]`; corpo vazio dá 400. ⚠ **Permissão:** o robô CLONEX recebeu **403** em 2026-09-22; tratado como ilegível (campos nulos), nunca como "sem baixa". Mesmo bloqueio registrado na ADR-0047. |
| `fin015/list` | **lotes SISPAG nativos** (contexto do painel) | `listLotesSispag({filCod?})` | `FinLoteSispag`: `bncCod`, `ccoCod`, `layoutConta`, `flpVldConfEnvio`, `soma`, analista | **READ (contexto).** 17 lotes reais (Itaú/Santander). NÃO participam do nosso ciclo de vida de lote candidato. |
| `fin010/list` (a-pagar) | **borderôs a-pagar** (contexto do painel) | `listBorderosAPagar({filCod?})` | `borCod`, `borVldTipo`, `borVldFinalizado`, `vldHasRemessaPgto` | **READ (contexto).** A baixa via borderô é o mecanismo massivo (`vldHasRemessaPgto≈0` em ~99% — baixa direta). |
| `fin015/…/titulosPendentes/list/{fil}/{bnc}/{flp}` | **flag de boleto DDA** por título | `ConexosSispagWriteClient.listarTitulosComBoletoDda({filCod, bncCod})` | `titVldReflexoDdaAssoc` (+ identidade `filCod`/`docCod`/`titCod`) | **READ.** Único vínculo pagamento↔boleto do ERP. Exige um `flpCod`: usa-se o lote nativo mais recente **como contexto de leitura** (não modificado; o grid é da FILIAL). Validado por Zod (`{0,1}`), não coagido — grid inteiro ilegível vira `ConexosError`. Consumido pela **ingestão**; o painel lê o resultado persistido em `tem_boleto`. Ver ADR-0040 §Emenda. |
| `fin124/list` · `fin124/itens/list/{ddcCod}` | **arquivos DDA e seus boletos** (diagnóstico) | — (sondas `jobs/probe-fin124-dda.ts`) | `FinDda`: `ddcCod`, `ddcEspFilename`, `ddcVldStatus` · `FinDdaItem`: `ditEspCodbar`, `ditMnyValor`, `ditDtaVencimento`, `docCod`/`titCod`/`flpCod` | **READ.** 143 arquivos, 100% com barras — mas `docCod`/`titCod` **0%** até o boleto ser consumido por um lote. **Não é por filial** (pool da conta pagadora). Não usado em runtime: o vínculo vem do flag acima. |

- **I1 (read-only):** o `ConexosSispagClient` **não importa** nenhum verbo de escrita nesta fatia.
  Toda escrita da fatia é **local** (`lote_pagamento`/`lote_pagamento_item`).
- **Reuso da infra:** mesmo padrão de auth (sid + `cnx-filcod` + `cnx-usncod`), `RetryExecutor` e
  Zod/guard nos boundaries do `ConexosClient` de Permutas; SSM em prod.
- **Constantes de tenant:** IDs de banco/conta/layout (Itaú 341, Santander 33, `layoutConta`) e
  níveis de alçada são da instalação Columbia — constantes tipadas, nunca hardcode em service
  (Inviolable Rule #2). Outra trading recalibra.

### Protocolo de PERGUNTA do ERP (`type: QUESTION`) — e como se responde

Algumas escritas do `fin015` não devolvem erro nem sucesso: devolvem **400 com uma pergunta**.

```json
{ "type": "QUESTION",
  "questions": [{ "id": "1", "key": "FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO",
                  "answerList": [{"id":"YES",…},{"id":"NO",…}] }] }
```

**A resposta** (medida em HML 2026-08-27; o Conexos não documenta): re-POST do **mesmo body**
com `answers: { "<question.id>": "YES" }` — um `Map<String,String>` chaveado pelo **`id`**, não
pelo `key`, e **não** um array. Outros sete encodings devolvem a mesma pergunta; o array devolve
`Cannot deserialize LinkedHashMap<String,String> from Array value`.

O POST que devolve `QUESTION` **não escreve nada** — é pré-commit, não escrita parcial. Por isso
o re-POST não é retry cego e não fere a doutrina de escrita não-idempotente (ADR-0013).

O envelope real está capturado em
`src/backend/domain/interface/sispag/__fixtures__/2026-08-27-fin015-question-barcode.json` e é
verificado pelo `contrato.test.ts` — inclusive a propriedade de que `answers` é chaveado pelo
`id` e **não** pelo `key`. Um rename no Conexos falha o CI em vez de falhar no banco.

**Allowlist de auto-resposta (uma chave, exata):**

| Chave | Auto-respondida? | Por quê |
|---|---|---|
| `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` | **sim, `YES`** | só confirma o uso do boleto que o próprio ERP casou. Não escolhe favorecido, valor nem forma. |
| `FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO` | **não** → `ErpPerguntaError` (409) | responder `YES` **altera a forma de pagamento** do título. Decisão de quem opera. |
| qualquer outra | **não** → `ErpPerguntaError` (409) | allowlist por chave exata; pergunta nova nunca entra de carona. |

Envelope com **2+ perguntas** também não é auto-respondível, mesmo contendo a allowlistada.

### ESCRITA SISPAG (vigente desde 2026-08-25)

`fin015` (L8) e o `processar` do `fin052` (L9/L10, administrativo) são escritas gated por
`conexosWriteEnabled`/`sispagLiveWriteEnabled`/`conexosDryRun`. A sincronização (L11, ADR-0055) é
**leitura** (`fin064` + `fin052` arquivos/detalhe + `com308` baixas) e suas gravações locais **não**
passam por esses gates. `fin015.flpVldRet` **não** é sinal de retorno: medido `false` em todos os
lotes nativos. O transporte (pasta de rede → VAN Nexxera) segue externo e manual.

### ESCRITA SISPAG — renegociação de centavos no título (ADR-0074, `planned`)

Provado em HML (2026-10-19, frnCod 3 e 4; G2/G3 e ponta a ponta pelo serviço de produção em 2026-10-20, frnCod 5–8). Composição com vencimento **passado** e **de hoje** aceita. Só pela ação `ajustarCentavosTitulo` (I18), sessão do servidor.

| Passo | Endpoint | Notas |
|---|---|---|
| criar | `POST fin070` | `pesCod = fin064.pesCodFor`, `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg`, obs MAIÚSCULA (marcador de correlação) |
| título | `POST fin070/titulos` | o título original; juros enviados aqui são ignorados |
| composição | `POST fin070/titulos/composicao` | mesmo valor aberto, vencimento original, `frgEspNumero`, `pgtCod`, `dupEspOrdem`; valor > aberto ⇒ `FIN_070.O_TOTAL_DOS_TITULOS_A_SEREM_GERADOS…` |
| ajuste | `PUT fin070` | `frnMnyValor = \|Δ\|`; `frnVldTpop` 1 acréscimo / 2 desconto; `0` com valor ⇒ `FIN_070.TIPO_OP_NAO_PERMITE_VALOR` |
| finalizar | `PUT fin070/finalizar/{frnCod}` | consome o original; nasce título novo no mesmo `docCod` (`totalLiquido` = boleto; `totalAberto` = base) |
| cancelar (não finalizada) | `DELETE fin070/titulos/composicao/{frnCod}/{docTip}/{docCod}/{titCod}/{frgCodSeq}` → `DELETE fin070/titulos/{frnCod}/{docTip}/{docCod}/{titCod}` → `DELETE fin070/{frnCod}` | **provado em HML (G3, 2026-10-19/20, frnCod 5 e 6)**, de baixo para cima, tentativa única. `PUT fin070/cancelar/{frnCod}` em não finalizada ⇒ `FIN_070.REGISTRO_DEVE_ESTAR_FINALIZADO` (é o estorno da FINALIZADA, não usado); `DELETE fin070` com título ⇒ `FIN_076.EXISTEM_TITULOS_RENEGOCIACAO`; `DELETE` do título com composição ⇒ `FIN_070.EXISTEM_COMPOSICOES_DESSA_RENEGOCIACAO_PARA_ESTE_TITULO`. Releitura: some do `fin070/list` e o `GET fin070/{frnCod}` volta `RECORDNOTFOUND` (HTTP 500); título original intacto. **O `frnCod` apagado é REUSADO** pela próxima renegociação |
| liberar | `POST fin103/validaSelecionado` → `POST fin103/aplicarComando {items:[linha fin103/list + fbaCod]}` | comando ativo "APROVAR" lido em `fin106/finBloqCmd/list/{fblCod}` |

O título novo pode nascer **bloqueado** na `fin103` (HML: regra 19, `vldLib 0`) e só aparece nos pendentes
do `fin015` depois de liberado. Em PRD o CLONEX não tem `fin070`/`fin026`/`fin103` no menu; a permissão do
login do servidor é o portão G1.

### ESCRITA SISPAG — borderô do boleto agrupado (ADR-0077, `implemented`)

Provado em HML em 2026-10-19 e medido de novo em 2026-10-20 (Task 1; `_inbox/sispag-boleto-agrupado-hml-achados.md`).
Emenda 2026-10-21 da ADR-0077: identidade do borderô = `filCod` + `borCod` + `borTimCad`; guarda da limpeza = lote
nativo. Só pelas ações
`prepararBorderoDoGrupo` / `limparBorderoDoGrupo` (I21l, I21q), dentro do L8. Reaproveita `ConexosBaixaClient`
(`criarBordero`, `listBaixas`, `excluirBaixa`, `excluirBordero`) e `ConexosSispagClient.listContasCorrentes`.

| # | Chamada | Corpo / regra |
|---|---|---|
| 1 | `fin005/list` | `gerNum` da conta pagadora do lote (H2, H10). Ausente ⇒ falha antes de escrever. |
| 2 | `POST fin010` | `{ filCod, borVldTipo 2, borVldFinalizado 0, frontModelName 'bordero', borDtaMvto = dataDebito do lote, gerNum }` ⇒ `borCod` e `borTimCad` (carimbo de criação gravado pelo ERP, ao segundo; inalterado por baixas, import e finalização, medido no borderô 252). O `borCod` é **reutilizado** depois de `excluirBordero` (max+1 da filial): **identidade = `filCod` + `borCod` + `borTimCad`**. Write-ahead: `t0` antes do `POST`, `t1` depois. **Nada é escrito em `borEspNrbanco`** (sem marcador): o cabeçalho do `fin010` não tem campo de observação; `borEspNrbanco` ("nº banco") é o único texto livre (medido: máx. 15 caracteres, só maiúsculas, filtra por `#EQ`/`#LIKE`), tem semântica nativa e não é usado. `GET fin010/{fil}/{bor}` de borderô ausente ⇒ **`500 RECORDNOTFOUND`**, não 404; ausência observada = `fin010/list` `borCod#EQ` sem linhas (ou só com outro `borTimCad`). Resposta perdida: `fin010/list` por `filCod`, `usnCodCad` (usuário do robô), `gerNum`, `borDtaMvto`, `borVldTipo 2`, `borVldFinalizado 0`, `borTimCad#GE`/`#LE` em **epoch ms** (medido: ISO ⇒ 500; `#GTE`/`#BETWEEN` não aceitos); margem de relógio = constante de código (I21s). |
| 3 | `POST fin010/baixas/validacao/tituloBaixa` | `{ filCod, borCod, borVldTipo 2, docTip 2, docCod, titCod, bxaVldSistema 0, bxaVldCcorrente 0, bxaVldCorrenteDc 1, bxaVldAdto 0, frontModelName 'baixa' }` ⇒ `bxaMnyValor`. |
| 4 | `POST fin010/baixas` | `responseData` + chave + `gerNum`, juros/multa/desconto 0, `bxaMnyLiquido = bxaMnyValor`. Títulos continuam em aberto no `fin064`, mas **somem** do grid `titulosPendentes` do `fin015` enquanto a baixa está no borderô em cadastro (V2). O `importarTitulos` com a linha lida antes da baixa é **aceito** depois da pergunta `FIN_041` (V2): o ERP não impede pagar duas vezes (I21k). |
| 5 | `GET fin015/finItemSispag/borderosPendentes/list/{fil}/{bnc}/{flp}` | Linha `{ borCod, pesCod, dpeNomPessoa, vlrTotal, borVldTipo, filCod, pesCodCont, itemy 0 }`. Só aparece se `gerNum` = conta do lote; o filtro **não** é a filial. A linha não traz `borTimCad` nem `borEspNrbanco`: a identidade é conferida antes, no `fin010`. |
| 6 | `POST …/borderosPendentes/importar` | `{ items: [{ …linha, filCodLote, bncCod, flpCod, itemy: 1 }], op: 1, bncCodFin015 }`. **`itemy 0` ⇒ `SUCESSO` sem importar** (H4): sucesso só pela releitura. |
| 7 | vínculo da barra | sequência I17e no item (`borCod`, sem `docCod/titCod`, nasce modalidade 4); `7` banco ≠, `6` banco = (H5). Medido (V5, 2026-10-20): barra do banco da conta com `7` ⇒ `400 FIN_015.TITULO_DEVE_SER_MODALIDADE_TITULO_PROPRIO`; barra de outro banco com `6` ⇒ `400 FIN_015.TITULO_NAO_PERTENCE_AO_BANCO_EM_USO`; a recusa vem no `confirmarCodigoBarras`, antes do `PUT`. |
| 8 | `finalizarLote` / `gerarRemessa` | inalterados; o J paga o total do borderô (H6). `vldHasRemessaPgto` do borderô **já** é 1 desde o `importar` (passo 6), não por causa da remessa (H9 corrigido em 2026-10-21). |
| 9 | retorno (`fin052` `processar`) | parser `ger015.gtbLngSql`: `BOR_COD` não nulo → `FIN_BORDERO` → `FIN_TITULO_RETBANCO` com `BOR_COD` → `PRC_BAIXA_RETORNO_PAGFOR('BAIXAR')`: finaliza o borderô e baixa os N (H7). Chave do J nas posições 183–202 (`fil(2) bnc(4) flp(7) its(7)`), ocorrência em 231. `.RET` sintético com J-52 falha (limite do sintético, H8). Linha de detalhe do `fin052` para o item de borderô (G4, `PG191081B.RET`, gar 7): **uma** linha (o J), com `filCod/bncCod/flpCod/itsCodSeq`, `borVldTipo/borCod/borDtaMvto/borVldFinalizado` e `ardEspObs "BORDERO: n - DATA DE CREDITO: …"`; **sem** `docCod/titCod`, `bxaCodSeq`, `pesCod`, valor pago ou `gerNum`. Casamento pela chave do item nativo e/ou `borCod` (I21r, I11i). |
| 10 | limpeza | `DELETE finItemSispag` → `excluirBaixa` × N → `excluirBordero`; só enquanto o **lote nativo** não está finalizado e não tem `.REM` gerado (lido ao vivo), e só o borderô com o nosso `borCod` + `borTimCad`. Nunca `finalizarBordero`/`cancelarBordero`/`fin146`. Ordem confirmada em HML (2026-10-20) e imposta pelo ERP: com o item no lote, `excluirBaixa`/`excluirBordero` ⇒ `400 FIN_014.FIN_HAS_REMESSA_PGTO`. Medido: `vldHasRemessaPgto` vira 1 no `importar` e volta a 0 no `DELETE` do item (não na geração do `.REM`); reflete o import e **não é guarda** (emenda 2026-10-21). |

Depois de um J rejeitado, o borderô antigo fica em cadastro e **nunca** é limpo por nós (se ele segue ligado
ao lote rejeitado, e com que valor de `vldHasRemessaPgto`, é medição da V7, não premissa). Se ele reaparecer em `borderosPendentes` (passo 5) do lote novo, é **reaproveitado** (I21s);
se não reaparecer nem tiver sido resolvido pela analista, o grupo é retirado da remessa (V7 em medição).
Não confundir com o borderô de **permuta** (Frente I, seção `fin010` acima): mesmo endpoint, outro uso.

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
