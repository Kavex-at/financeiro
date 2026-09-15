# Tasks: permutas-saldo-ordem-centavos

**Spec source:** `ontology/_inbox/permutas-saldo-ordem-centavos-interview.md` (decisões do usuário, 2026-09-14)
· `ontology/decisions/0046-tolerancia-residuo-prioridade-motivos-saldo-restante.md` (em redação pelo OntologyCurator)

**Ontology diff:** sim. O OntologyCurator está editando em paralelo `decisions/0046-*.md`,
`actions/avaliar-elegibilidade.md` e `business-rules/elegibilidade-permuta.md`. O código fica **atrás**
da ontologia até esta branch fechar. `entity_changed = false` (nenhuma entidade, estado ou motivo novo:
mudam dois predicados de gate, a ordem de escolha do motivo e a definição de "alocação consumida").

**Estimated scope:** **L**. São 7 tasks, ~11 arquivos de produção (backend + frontend) e ~8 de teste.
Uma das mudanças é de regra (Fix 3). Não há migration, handler novo nem `infra/`.

> Layout deste repo: `src/backend/` e `src/frontend/` (não `backend/src/`). Gates:
> `cd src/backend && npm run typecheck && npm run lint && npm test`
> `cd src/frontend && npm run typecheck && npm run lint && npm test`

---

## Achados do scoping (medidos no worktree @ 3872903, não redescobrir)

### A1. Codificação do borderô (confirmada)
`BorderoGestaoService.situacaoDoItem` (`:596-605`) é a fonte da derivação:
`borCodEstornado != null` ⇒ **ESTORNADO** (vence tudo); senão `borVldFinalizado` **1 = FINALIZADO**,
**2 = CANCELADO**, `0`/ausente = **EM CADASTRO**. O `finalizarBordero` grava `1` no cache
(`:224-226`) e o `cancelarBordero` grava `2` (`:244-246`). Logo, "finalizado e vivo" no cache é
`permuta_bordero.bor_vld_finalizado = 1 AND bor_cod_estornado IS NULL`, com join por
**(fil_cod, bor_cod)** (PK desde a migration 0020; o `bor_cod` é sequencial por filial).

### A2. Semântica de `parcial` e da re-alocação (ADR-0044)
- `permuta_alocacao` tem **uma linha por par** (`UNIQUE (adiantamento_doc_cod, invoice_doc_cod)`).
  Re-alocar faz UPSERT: sobrescreve `valor_alocado` e renova `atualizado_em = now()`
  (`PermutaAlocacaoRepository.upsertAlocacao:59-99`). A execução **não guarda** o valor alocado da
  versão executada.
- A chave de idempotência é `permuta:<adto>:<invoice>:<atualizadoEm.getTime()>`
  (`ReconciliacaoPermutaService.ts:269`), mas **só desde a v0.6.0 (47f2cf0, 2026-06-24)**. Antes, a
  chave não tinha o timestamp. Por isso o casamento execução ↔ versão da alocação **não pode depender
  do formato da chave**.
- `valor_residual_usd` fica em moeda negociada (mesma unidade de `valor_alocado`). Já `valor_baixado`
  fica em **BRL** (`totalBaixadoBrl`, somado pela taxa de cada título da invoice) e não serve para
  subtrair de `valor_alocado`.
- **Regra adotada (Task 5):** uma execução pertence à versão **atual** da alocação quando
  `execucao.criado_em >= alocacao.atualizado_em` (mesmo relógio, o `now()` do Postgres; o
  `beginExecution` sempre roda depois do UPSERT). Execuções de versões anteriores do par **não**
  abatem a versão atual. O que elas consumiram já saiu do `valorPermutar` do ERP e não está mais em
  nenhuma linha de alocação.
  > ⚠️ **Divergência com o rascunho da ADR-0046 D3** ("Σ baixado de TODAS as execuções consumidas do
  > par, piso zero"). Essa fórmula erra justamente no caso da parcial re-alocada. Exemplo: alocado
  > 100, parcial com resíduo 10 em borderô finalizado (ERP abate 90), e o analista re-aloca o par
  > para 10. A fórmula da ADR dá `max(0, 10 − 90) = 0`, o saldo fica 10 acima do real e permite
  > super-alocação. A regra por versão dá `10`, que é o correto. E a fórmula da ADR nem é computável,
  > porque o 100 não está mais guardado. **Pedir ao OntologyCurator para ajustar D3.**

### A3. Janela de frescor: o painel torna a janela determinística (decisão de escopo)
A entrevista aceitou "borderô finalizado DEPOIS da última ingestão ⇒ saldo superestimado ≤ 6h". O
scoping mostrou que o caminho **mais comum** é justamente esse. O botão **Finalizar** do painel grava
`bor_vld_finalizado = 1` no cache **na hora** (`BorderoGestaoService.ts:224`), enquanto o
`valorPermutar` do adto só é relido na próxima ingestão. Sem guarda, logo depois de Finalizar o adto
voltaria à aba de trabalho com o saldo cheio (hoje ele vai para o Histórico, via
`permutaManualCompleta`, `page.tsx:562-563`), e o teto do `alocar` aceitaria realocar o mesmo valor.
A baixa **não** revalida o saldo do adto ao vivo (ver F1). Isso fere o princípio da própria
entrevista ("subestimar nunca permite super-alocação").
**Incluído (Task 4):** a execução só conta como consumida quando o cache viu o borderô finalizado
**antes** do início da ingestão que carimbou o `valorPermutar` do adto:
`permuta_bordero.atualizado_em < permuta_eleicao_run.started_at` (run = `permuta_adiantamento.last_ingest_run_id`).
O `startedAt` da ingestão é tomado antes do `computeCandidatas` (`IngestaoPermutasService.ts:74-78`),
então toda leitura de detalhe acontece depois dele. Para isso funcionar, o `replaceBorderoCache` passa
a renovar `atualizado_em` **só quando a situação muda**. Hoje ele renova em todo refresh
(`PermutaExecucaoRepository.ts:512-519`), inclusive no botão "Atualizar" da tela de Borderôs.
Isso provavelmente também explica o "risco residual" da ADR (2 adtos, +1, com `fin=1` e sem abate).
Efeito de rollout: até a 1ª ingestão pós-deploy, as linhas antigas do cache têm `atualizado_em`
posterior ao último `started_at` e seguem descontando (comportamento de hoje). Depois disso ficam
corretas. Skew app × DB: `started_at` vem do relógio do app e `atualizado_em` do `now()` do Postgres.
Segundos de diferença são aceitáveis, porque as leituras de detalhe levam minutos depois do start.
**Se o Yuri preferir manter a janela aceita, basta remover a Task 4 e o critério de frescor da Task 3.**

### A4. Caminho Simples NÃO tem o defeito (fora do escopo)
`GestaoPermutasService.toCasamentos` (`:569-576`) calcula `saldoNeg − valorASerUsado`, e
`valorASerUsado` é o **plano** do greedy calculado na mesma ingestão, a partir do mesmo `valorPermutar`
(`IngestaoPermutasService.toCasamentoRows:446-517`). Não entra alocação histórica. O mesmo vale para
`adtosQueUltrapassamInvoice` (`:237-263`) e para `autoElegivel` (`:376-382`). **Nenhuma mudança.**

### A5. Consumidores do `pago` do detalhe (`ConexosTitulosClient.mapDetalheTitulos:356-380`, `pago = valorAberto === 0`)
| Consumidor | Documento | Efeito do Fix 3 |
|---|---|---|
| `EleicaoPermutasService.buildCandidata:761-801` (hidrata `Adiantamento.pago`) → Gate 3 + roteamento `:816-824` | **ADIANTAMENTO** | **aplica a tolerância aqui** |
| `AlocacaoPermutasService.buscarInvoices:127-137` (`aberta = det.pago !== true`) | INVOICE | inalterado (continua estrito) |
| `EleicaoPermutasService:947-966` (lê só `valorAberto` da invoice) | INVOICE | inalterado |
| `jobs/validate-invoice-pago-detalhe-v1.ts`, `probe-*` | INVOICE | inalterado |
| `RelatorioExportService:207`, `GestaoPermutasService.toDetalhe:447`, `VisaoGeralTable.tsx:257` | lê `permuta_adiantamento.pago` persistido | passa a refletir o `pago` com tolerância (coerente com o novo I3) |
| SISPAG (`LotePagamentoService:187`, `IngestaoPagamentosService:147`, `SispagPainelService:401/415`) e `ReconciliacaoPermutaService:739` | `TituloAPagar.pago` numérico do **com308/list** (`ConexosBaseClient.isPago:370`) | não usam o mapper do detalhe, **inalterados** |
| Recebimentos | não consomem `getDetalheTitulos` | inalterado |

**Conclusão:** o mapper do client **não muda**. A tolerância entra como regra de domínio aplicada só
na hidratação do adiantamento e nos gates.

### A6. Prioridade dos motivos: testes e compatibilidade do snapshot
- Nenhum teste fixa `data-base-indisponivel` à frente de `nao-pago`/`ja-permutado`. Os testes atuais
  (`ElegibilidadeService.test.ts:210-218`; `EleicaoPermutasService.test.ts:262-283`) usam adto pago e
  com saldo, e continuam passando.
- `permuta-snapshot-estados-tasks.md` (Task 3, critério "branch `data-base-indisponivel` não muda") era
  restrição daquele delta, não invariante. Esta ADR a revoga explicitamente.
- `permuta_candidata_snapshot` e `permuta_adiantamento` guardam motivo/estado como string. Todos os
  valores já existem (`ja-permutado` desde a migration 0054). **Sem migration e sem back-compat.** Só
  mudam as contagens (`bloqueadas_by_motivo` encolhe em `data-base-indisponivel`), o que é correção.

### A7. Dados do Histórico (Fix 4)
- `/permutas/gestao` **já devolve** os `ja-permutado` (`listAdiantamentosAtivos` sem filtro de estado),
  com `importador`, `filCod`, `exportador`, `detalhe.priCod` e `valorMoedaNegociada`. **Mas não devolve
  `alocacoes`**, que só são montadas quando `podeAlocar` (`GestaoPermutasService.ts:344-349`).
- `/permutas/.../status` (`BorderoGestaoService.statusPorAdiantamento:525-575`) cobre **todo** adto com
  execução terminal real e borderô válido, **independente do estado de elegibilidade**. Então já cobre
  os `ja-permutado`.
- A flag de cliente-filtro **não** está no payload da gestão. Proposta (Task 6): o tipo é derivado das
  alocações (`Cross-process` se alguma alocação tem `invoicePriCod ≠ detalhe.priCod`). Caso contrário,
  o rótulo é neutro: `Já permutado`. Isso reflete o que de fato foi executado e não depende do
  cadastro de filtros, que muda com o tempo. Confirmar o rótulo com o DesignSystemReviewer.

### Follow-ups detectados (NÃO implementar; ir para `_inbox` no Regis)
- **F1:** a baixa não valida o saldo do adto ao vivo. `ReconciliacaoPermutaService.reconciliarSerializado`
  lê o adto do banco (`findAdiantamento:187`) e não chama `getDetalheTitulos`. Só a invoice é relida
  ao vivo (I-Write-1/9). O teto do adto depende do snapshot.
- **F2:** re-alocar um par cuja execução está em borderô **em cadastro** sobrescreve `valor_alocado`.
  A parte já lançada, e ainda não abatida pelo ERP, deixa de ser descontada. É pré-existente e não
  vem desta mudança.
- **F3:** `statusPorAdiantamento` indexa `sitByBor` só por `borCod` (`:541`), sem filial. Pode haver
  colisão entre filiais, o mesmo débito já registrado em `clearBorCod`.
- **F4:** `autoAlocarSeElegivel`/`autoAlocarDeCasamento` retornam `true` se já existe **qualquer**
  alocação (`AlocacaoPermutasService.ts:341-344, 440-443`). Um Simples parcialmente executado nunca
  auto-aloca o saldo remanescente.

---

**Status AutoLoopRunner (2026-09-14):** Tasks 1-7 implementadas e verdes (backend 135 suites/1953
testes; frontend 40 suites/328 testes; PatternGuardian PASS; DesignSystemReviewer PASS; SpecVerifier
64 APROVADO / 0 REPROVADO / 3 não verificáveis = fase vermelha). Ground truth ao vivo: 247 linhas,
0 DIVERGENTE, 6 EXPLICADO, 1 SEM_GROUND_TRUTH (V3). Desvio anotado: o Gate 3 usa |mnyTitAberto| ≤ R$1,00
(sobrepagamento negativo, doc 4058, segue `nao-pago`). Pendentes do orquestrador: Regis-Review, rebase,
bump de versão, PR.

## Task list

### Task 1: Testes que falham — tolerância de R$ 1,00 e prioridade dos motivos (Fix 3 + Fix 2)
**Files to change:**
- `src/backend/domain/interface/permutas/ToleranciaResiduo.test.ts` (novo)
- `src/backend/domain/service/permutas/ElegibilidadeService.test.ts` (novo `describe` após `:172`)
- `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts` (bloco cliente-filtro `:225-283`)
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts` (só se precisar provar que a âncora usa a constante compartilhada)

**Acceptance criteria:**
- [x] `ToleranciaResiduo.test.ts`: `semSaldoPermutar(0.10) === true`, `semSaldoPermutar(1.00) === true`, `semSaldoPermutar(1.01) === false`, `semSaldoPermutar(undefined) === true`; `adiantamentoTotalmentePago({ valorAberto: 0.02 }) === true`, `({ valorAberto: 1.00 }) === true`, `({ valorAberto: 1.01 }) === false`, `({ valorAberto: 21.01 }) === false`, `({}) === false`, `({ pago: true }) === true`; nenhum caso de float (ex.: `0.1 + 0.2`, `1.0000000001`) muda o veredito na fronteira (comparação em centavos)
- [x] `ElegibilidadeService`: adto `pago=true`, `valorPermutar=0`, `valorPermutado=1500`, `declaracoes=[]` → `estadoElegibilidade=JA_PERMUTADO`, `motivoBloqueio='ja-permutado'` (hoje devolve `BLOQUEADA/data-base-indisponivel`)
- [x] `ElegibilidadeService`: adto `pago=false`, `valorPermutar=1000`, `declaracoes=[]` → `BLOQUEADA/nao-pago`
- [x] `ElegibilidadeService`: adto `pago=false`, `valorPermutar=0`, `declaracoes=[]` → `BLOQUEADA/nao-pago`
- [x] `ElegibilidadeService`: adto `pago=true`, `valorPermutar=0`, sem `valorPermutado`, `declaracoes=[]` → `BLOQUEADA/sem-saldo-permutar`
- [x] `ElegibilidadeService`: adto `pago=true`, `valorPermutar=1000`, `declaracoes=[]` → continua `BLOQUEADA/data-base-indisponivel` (e `declaracoes=[di, duimp]` → `di-duimp-ambos`)
- [x] `ElegibilidadeService`: `valorPermutar=0.10`, `pago=true`, `valorPermutado=5000`, com D.I → `JA_PERMUTADO` (resíduo INOX); `valorPermutar=1.00` → `JA_PERMUTADO`; `valorPermutar=1.01` → Gate 2 passa (segue para o casamento de invoice)
- [x] `ElegibilidadeService`: `gatesAvaliados` segue com 4 entradas, na mesma ordem e com os mesmos `gate`, e o Gate 2 `passed=false` para `valorPermutar ≤ 1.00`
- [x] `EleicaoPermutasService` (hidratação): `getDetalheTitulos` mock `{ valorPermutar: 0, valorAberto: 0.02, valorPermutado: 20373009.87 }` (doc 8721, **sem** `pago`) → candidata **não** tem `motivoBloqueio='nao-pago'` e `adiantamento.pago === true`
- [x] `EleicaoPermutasService`: mock `{ valorPermutar: 1000, valorAberto: 21.01 }` (doc 3754) → `BLOQUEADA/nao-pago`, `adiantamento.pago === false`
- [x] `EleicaoPermutasService` (roteamento cliente-filtro): pago + `valorPermutar=0.10` + sem D.I + importador filtro → **não** roteia para `PERMUTA_MANUAL` (fica `JA_PERMUTADO` se `valorPermutado>0`); pago + `valorPermutar=1.01` + sem D.I + filtro → `PERMUTA_MANUAL/cliente-filtro`
- [x] Os testes existentes `:262-283` (filtro pago com saldo → permuta-manual; não-filtro → data-base-indisponivel; filtro não pago → BLOQUEADA) continuam no arquivo sem alteração
- [x] Rodando `cd src/backend && npx jest ToleranciaResiduo ElegibilidadeService EleicaoPermutasService`, os testes novos **falham** (vermelho registrado antes da Task 2)

**Dependencies:** none

---

### Task 2: Implementar tolerância R$ 1,00 (constante única) e prioridade única dos motivos
**Files to change:**
- `src/backend/domain/interface/permutas/ToleranciaResiduo.ts` (novo): `export default class ToleranciaResiduo` com `public static readonly LIMITE_BRL = 1`, `public static readonly semSaldoPermutar = (valorPermutar?: number): boolean` e `public static readonly adiantamentoTotalmentePago = (d: { pago?: boolean; valorAberto?: number }): boolean`, com comparação em centavos (`Math.round(v * 100) <= LIMITE_BRL * 100`)
- `src/backend/domain/service/permutas/ElegibilidadeService.ts`: Gate 2 `:65-70` (`passed: !ToleranciaResiduo.semSaldoPermutar(...)`); remover o early-return `:83-91`; `motivoDoGateFalho` `:146-172` recebe o `motivo` do Gate 4 e resolve `nao-pago → ja-permutado|sem-saldo-permutar → data-base-indisponivel|di-duimp-ambos → falha-gate`; atualizar docblocks `:40-49` e `:132-145`
- `src/backend/domain/service/permutas/EleicaoPermutasService.ts`: hidratação `:796-801` (`pago: ToleranciaResiduo.adiantamentoTotalmentePago({ pago: detalhe.pago, valorAberto: detalhe.valorAberto })`); roteamento `:816-820` (`!ToleranciaResiduo.semSaldoPermutar(hydrated.valorPermutar)`)
- `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts`: `:934` `const limiteResiduo = 1` → `ToleranciaResiduo.LIMITE_BRL` (sem mudança de comportamento)
- `src/backend/domain/interface/permutas/PermutaCandidata.ts` `:14-16` e `Adiantamento.ts` `:8-11, 26, 71-74` (só comentários: `> R$1,00` / `≤ R$1,00`)

**Acceptance criteria:**
- [x] Todos os testes da Task 1 passam
- [x] `ConexosTitulosClient.mapDetalheTitulos` (`:356-380`) **não foi alterado** (`git diff` vazio no arquivo). `pago` do wire segue `valorAberto === 0`
- [x] `AlocacaoPermutasService.buscarInvoices` (`:127-137`) não foi alterado: invoice com `valorAberto=0.02` segue "em aberto" (teste existente ou novo em `AlocacaoPermutasService.test.ts` prova isso)
- [x] `grep -rn "limiteResiduo = 1" src/backend/domain` → 0 ocorrências; `grep -rn "LIMITE_BRL" src/backend/domain` → `ToleranciaResiduo.ts`, `ElegibilidadeService`/`EleicaoPermutasService` (via predicados) e `ReconciliacaoPermutaService`
- [x] `ElegibilidadeService` não tem mais nenhum `return` com `DATA_BASE_INDISPONIVEL` antes de `algumGateFalhou`. A ordem de prioridade existe em **um único** método (`motivoDoGateFalho`)
- [x] Os testes existentes de `ElegibilidadeService.test.ts`, `EleicaoPermutasService.test.ts`, `ReconciliacaoPermutaService.test.ts` (âncora I-Write-6 `residuo ≤ 1`) e `IngestaoPermutasService.test.ts` passam sem mudar asserções
- [x] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅

**Dependencies:** Task 1

---

### Task 3: Testes que falham — saldo restante sem dupla contagem (Fix 1)
**Files to change:**
- `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.test.ts` (novo)
- `src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts` (novo `describe` p/ `listConsumosFinalizados`; ajuste do `replaceBorderoCache` `:440-450`)
- `src/backend/domain/repository/permutas/PermutaAlocacaoRepository.test.ts` (`listByAdiantamento`)
- `src/backend/domain/service/permutas/GestaoPermutasService.test.ts`
- `src/backend/domain/service/permutas/AlocacaoPermutasService.test.ts`

**Acceptance criteria:**
- [x] `SaldoAlocacaoAdiantamentoService.naoConsumido` (puro): alocação `valorAlocado=49622.46`, `atualizadoEm=T0`, com consumo `{status:'settled', criadoEm: T0+1min}` → `0`
- [x] parcial finalizado: alocação `100`, consumo `{status:'parcial', valorResidualUsd: 10, criadoEm > atualizadoEm}` → `10`; `valorResidualUsd` ausente → `100` (conservador); `valorResidualUsd=150` → `100` (teto no alocado)
- [x] versão: alocação re-alocada (`atualizadoEm=T2`) com consumo `settled` de `criadoEm=T1 < T2` → `valorAlocado` inteiro (execução de versão anterior não abate)
- [x] sem consumo (rascunho, `pending`, `reconciling`, `error`, borderô em cadastro/cancelado/estornado/ausente do cache: todos filtrados pela query) → `valorAlocado`
- [x] vários consumos do mesmo par e da mesma versão → vale o de maior `criadoEm`; consumo de **outro** par do mesmo adto não afeta
- [x] **Caso 12860:** adto `valorPermutar/taxa = 30364.73`, uma alocação `49622.46` consumida (borderô 19981 finalizado) → `GestaoPermutasService.exporGestao` devolve `saldoRestante` = **30364.73** (±0.005) para o pendente `permuta-manual` (hoje −19257.73)
- [x] **Caso 9328:** `valorPermutar/taxa = 39652.47`, alocação `35347.53` consumida → `saldoRestante` = **39652.47** (hoje 4304.94); vale para `permuta-manual` **e** `casamento-manual`
- [x] **Casos 9335/9869/9870/10307:** alocação sem consumo (borderô ausente do cache / `fin=2`) → `saldoRestante = valorPermutar/taxa − valorAlocado` (inalterado)
- [x] **Teto:** `AlocacaoPermutasService.alocar` para 9328 com `valorAlocado=39000` e a outra alocação consumida → **não** lança `AlocacaoSaldoError`; com a outra alocação **não** consumida → lança com `disponivel = 4304.94`
- [x] re-alocação do mesmo par exclui o próprio par da soma (paridade com o `excludeInvoiceDocCod` de hoje)
- [x] `PermutaExecucaoRepository.listConsumosFinalizados`: o SQL contém `e.dry_run = false`, `e.status IN ('settled', 'parcial')`, join `b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod`, `b.bor_vld_finalizado = 1`, `b.bor_cod_estornado IS NULL`, join `permuta_adiantamento` → `permuta_eleicao_run` por `last_ingest_run_id`, `b.atualizado_em < r.started_at`, filtro opcional `($adtoDocCod::text IS NULL OR e.adiantamento_doc_cod = $adtoDocCod)`; nenhuma interpolação de valor (params passados em objeto)
- [x] `replaceBorderoCache`: o SQL do `ON CONFLICT` renova `atualizado_em` **só** quando `bor_vld_finalizado` ou `bor_cod_estornado` são `IS DISTINCT FROM` o `EXCLUDED` (os demais campos seguem atualizados)
- [x] Os testes novos **falham** antes das Tasks 4 e 5

**Dependencies:** Task 2 (para não misturar vermelhos de dois fixes no mesmo run)

---

### Task 4: Repositório — consumos finalizados (com guarda de frescor) e cache de borderô com carimbo de mudança
**Files to change:**
- `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts`: novo `ConsumoExecucaoRow` + `public listConsumosFinalizados = async (adiantamentoDocCod?: string)` (seção após `listComBordero` `:145-156`); `replaceBorderoCache` `:494-528` (`atualizado_em = CASE WHEN ... IS DISTINCT FROM ... THEN now() ELSE permuta_bordero.atualizado_em END`); `updateBorderoCacheSituacao` `:530-547` com a mesma regra
- `src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts`: novo `listByAdiantamento` (parametrizado); **remover** `sumByAdiantamento` `:109-122` (único consumidor: `AlocacaoPermutasService:247`, migrado na Task 5)

**Acceptance criteria:**
- [x] Testes de repositório da Task 3 passam
- [x] `ConsumoExecucaoRow = { adiantamentoDocCod: string; invoiceDocCod: string; status: 'settled' | 'parcial'; valorResidualUsd?: number; criadoEm: Date }`, com mapeamento sem `!` e sem cast de `status` fora da união (guard explícito)
- [x] SQL 100% parametrizado (`$adtoDocCod`), sem `${}` com dado
- [x] `listBorderoCache`, `borderoDoPar`, `statusPorAdiantamento` e a tela de Borderôs não mudam de comportamento (testes existentes de `PermutaExecucaoRepository.test.ts` e `BorderoGestaoService.test.ts` passam; só o teste de SQL do `replaceBorderoCache` é ajustado)
- [x] `grep -rn "sumByAdiantamento" src/backend` → 0 ocorrências após a Task 5
- [x] `cd src/backend && npm run typecheck && npm run lint` ✅ (o `npm test` completo fecha na Task 5)

**Dependencies:** Task 3

---

### Task 5: Serviço único do saldo não consumido — ligar em `GestaoPermutasService` e no teto do `alocar`
**Files to change:**
- `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts` (novo, `@injectable()`): `naoConsumido(alocacao, consumos)` (puro), `somaNaoConsumida(alocacoes, consumos)` (puro), `carregarConsumosPorAdiantamento(): Promise<Map<string, ConsumoExecucaoRow[]>>` e `somaNaoConsumidaDoAdiantamento(adiantamentoDocCod, excludeInvoiceDocCod?)`. Docblock com a regra de A2 e A3 e a referência à ADR-0046
- `src/backend/domain/service/permutas/GestaoPermutasService.ts`: construtor `:58-68` (injetar o serviço); `Promise.all` `:71-87` (+ `carregarConsumosPorAdiantamento`); `toPendente` recebe os consumos do adto; `saldoRestante` `:353-356` → `saldoNeg − somaNaoConsumida(...)`; comentário `:340-343`
- `src/backend/domain/service/permutas/AlocacaoPermutasService.ts`: construtor (injetar o serviço); `:247-257` `jaAdto = await somaNaoConsumidaDoAdiantamento(adiantamentoDocCod, invoiceDocCod)`
- `src/frontend/app/permutas/page.tsx` `:557-561` (só o comentário: "saldoRestante = saldo negociado − Σ alocações ainda NÃO consumidas pelo ERP")

**Acceptance criteria:**
- [x] Todos os testes da Task 3 passam (12860 → 30364.73; 9328 → 39652.47; não consumidos seguem descontando; teto do `alocar` coerente com a tela)
- [x] Existe **uma** implementação da regra "consumida": `grep -rn "valorAlocado, 0)\|+ al.valorAlocado" src/backend/domain/service` → 0 ocorrências de soma crua de alocações para saldo do adto
- [x] `toCasamentos` (`:569-576`), `adtosQueUltrapassamInvoice` e `autoElegivel` **não** mudam (A4)
- [x] `ReconciliacaoPermutaService` não muda (F1 fica como follow-up)
- [x] Os testes existentes de `GestaoPermutasService.test.ts` e `AlocacaoPermutasService.test.ts` passam. Os mocks de DI ganham o serviço novo, sem mudar asserções de comportamento
- [x] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅
- [x] `cd src/frontend && npm run typecheck && npm run lint` ✅
- [x] PatternGuardian ✅ (DI tsyringe, arrow methods, access modifiers, SQL parametrizado)

**Dependencies:** Task 4

---

### Task 6: Histórico inclui `ja-permutado` com borderô do painel, sem duplicar (Fix 4)
**Files to change:**
- `src/backend/domain/service/permutas/GestaoPermutasService.ts` `:344-349`: `alocacoes` também quando `status === 'ja-permutado'` e houver alocações (só exibição; **não** calcula `saldoRestante` nem `tipoPermuta` para `ja-permutado`)
- `src/backend/domain/interface/permutas/Gestao.ts` `:102-103` e `src/frontend/lib/types.ts` (~`:140-146`): comentário de `alocacoes` ("permuta-manual, casamento-manual e ja-permutado")
- `src/frontend/app/permutas/components/historico.ts` (novo): função pura `montarHistorico({ casamentosSugeridos, multiplasManuais, crossOver, crossProcess, jaPermutados, statusPorAdto, pendenteByDocCod })` extraída de `page.tsx:595-652`, com dedupe por `${adtoDocCod}:${borCod}`
- `src/frontend/app/permutas/components/historico.test.ts` (novo)
- `src/frontend/app/permutas/page.tsx` `:595-652`: usar `montarHistorico`, passando `jaPermutados = pendentes.filter(p => p.status === 'ja-permutado')`

**Acceptance criteria:**
- [x] (teste primeiro) `historico.test.ts` falha antes da mudança e passa depois
- [x] adto `ja-permutado` **com** `statusPorAdto[docCod]` → 1 item no histórico, com `borCod`, `finalizado` (de `permutaStatus==='finalizado'`), `cliente=importador`, `priCod=detalhe.priCod`, `valor = Σ alocacoes.valorAlocado` (fallback `valorMoedaNegociada`)
- [x] adto `ja-permutado` **sem** `statusPorAdto` → não aparece
- [x] tipo: `'Cross-process'` quando alguma alocação tem `invoicePriCod` definido e `≠ detalhe.priCod`; caso contrário `'Já permutado'` (rótulo confirmado pelo DesignSystemReviewer)
- [x] dedupe: o mesmo `adtoDocCod:borCod` vindo de `crossProcess` e de `jaPermutados` (ou de `casamentosSugeridos`) gera **1** item; `key` estável e único (sem warning de key duplicada do React)
- [x] os itens atuais (Automática, Múltipla, Cross-over, Cross-process) saem idênticos aos de hoje (teste de paridade com fixture das 4 categorias)
- [x] ordenação: a mesma de hoje (`borCod` desc + `ordenarPorEtapaPermuta`)
- [x] backend: `GestaoPermutasService.test.ts`, pendente `ja-permutado` com 2 alocações → `alocacoes.length === 2` e **sem** `saldoRestante`
- [x] `cd src/frontend && npm run typecheck && npm run lint && npm test` ✅
- [x] `cd src/backend && npm run typecheck && npm run lint && npm test` ✅
- [x] DesignSystemReviewer gate ✅ (`page.tsx`, `historico.ts`)

**Dependencies:** Task 2 (os `ja-permutado` só surgem em volume após Fix 2/3); Task 5 (mesmo arquivo `GestaoPermutasService.ts`)

---

### Task 7: Script de validação ground-truth (read-only) `validate-permutas-saldo-ordem-centavos-v1.ts`
**Files to change:**
- `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (novo; convenção de `jobs/validate-invoice-pago-detalhe-v1.ts`: `import 'reflect-metadata'`, `dotenv/config`, `bootstrapAppContainer`, recusa produção sem `PROBE_ALLOW_PRD=1`)

**Acceptance criteria:**
- [x] Importa as funções de **produção** (`ToleranciaResiduo`, `ElegibilidadeService.avaliarElegibilidade`, `SaldoAlocacaoAdiantamentoService.naoConsumido/somaNaoConsumida`) sem reimplementar regra
- [x] Só leituras: `GET com298/{docCod}` (`getDetalheTitulos`), `fin010/list` com `borCod#IN` (`ConexosBaixaClient.listBorderos`), `listDeclaracaoByProcesso`, e `SELECT` no Postgres. Nenhum `INSERT/UPDATE/DELETE`, nenhum POST de escrita (revisão do diff comprova)
- [x] Executa as comparações e emite a tabela do "Plano de Validação Ground-Truth" abaixo (EXATO / OK_CENTAVO / DIVERGENTE / EXPLICADO / SEM_GROUND_TRUTH por `docCod`) e sai com `exit 1` se houver DIVERGENTE não explicado
- [x] `cd src/backend && npm run typecheck && npm run lint` ✅
- [x] Executado ao vivo pelo GroundTruthValidator após o verde das Tasks 1-6, em sessão única, com resultado anexado ao PR

**Dependencies:** Tasks 2, 5

---

## Definition of Done

All tasks complete AND:
- [x] `cd src/backend && npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅
- [x] `cd src/frontend && npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅
- [x] PatternGuardian gate ✅
- [ ] Ontology diff presente (ADR-0046 + `actions/avaliar-elegibilidade.md` + `business-rules/elegibilidade-permuta.md`), **com D3 ajustado para a regra por versão (A2) e a guarda de frescor (A3)** ✅
- [x] DesignSystemReviewer gate ✅ (frontend tocado: `page.tsx`, `historico.ts`)
- [x] ObservabilityAdvisor: **não se aplica** (sem handler/job novo; o script de validação é one-off read-only)
- [x] AwsInfraArchitect: **não se aplica** (sem `infra/`)
- [x] Ground-Truth Validation gate: `validate-permutas-saldo-ordem-centavos-v1.ts` executado ao vivo, todas as linhas EXATO/OK_CENTAVO/EXPLICADO, zero DIVERGENTE não explicado ✅
- [ ] Regis-Review gate ✅ (0 P0; P1/P2/P3 e F1-F4 → `ontology/_inbox/permutas-saldo-ordem-centavos-regis-followups.md`)
- [ ] Rebase de `main` aplicado, gates ainda verdes ✅
- [ ] Delta tem `fix` (e mudança de regra) em `src/` ⇒ versão do app bumpada (FE+BE lockstep) via `scripts/bump-version.ps1 -Execute` no Ship + `CHANGELOG.md` atualizado ✅

---

## Plano de Validação Ground-Truth

> **Catálogo:** `ontology/ground-truths/` **não existe** neste repositório (verificado no worktree).
> Segue o precedente versionado `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts`: o ground truth
> nativo é o bloco **RESUMO DOS TÍTULOS** do `GET com298/{docCod}` e o status do borderô no `fin010/list`.
> **Classificação: GT real** para as três grandezas abaixo.

**Script:** `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (Task 7).
Run: `cd src/backend && PROBE_ALLOW_PRD=1 tsx jobs/validate-permutas-saldo-ordem-centavos-v1.ts`

**Fonte (read-only):**
- ERP ao vivo: `getDetalheTitulos` → `mnyTitPermutar` (valorPermutar, BRL), `mnyTitPermuta` (valorPermutado, BRL), `mnyTitAberto` (valorAberto, BRL); `listBorderos({ filCod, borCods })` → `borVldFinalizado`, `borCodEstornado`; `listDeclaracaoByProcesso`
- Banco (SELECT): `permuta_alocacao`, `permuta_alocacao_execucao` (real, terminal), `permuta_adiantamento` (`taxa`, `valor_moeda_negociada`, `fil_cod`, `pri_cod`)

**Chave de comparação:** `docCod` do adiantamento (e `docCod:borCod` na classificação de consumo).

**Tolerância:** R$ 0,01 (BRL) · USD 0,01 (moeda negociada).

### V1. Saldo restante (Fix 1): nossa fórmula com insumos ao vivo vs ERP
Para cada adto, o validador monta os consumos a partir do **status vivo** do borderô (sem a guarda de
frescor, que é propriedade do snapshot e tem teste unitário) e calcula
`nosso = mnyTitPermutar_vivo / taxa − somaNaoConsumida(alocações, consumos_vivos)`.
Ground truth da classificação: `abateu ⇔ |valorMoedaNegociada − mnyTitPermutar_vivo/taxa − Σ consumido| ≤ USD 0,01`.

| Amostra | Esperado |
|---|---|
| 12860 (borderô 19981 finalizado) | `mnyTitPermutar/taxa` ≈ **30.364,73** e `nosso` = **30.364,73** ± 0,01 |
| 9328 (borderô 19534 finalizado) | `mnyTitPermutar/taxa` ≈ **39.652,47** e `nosso` = **39.652,47** ± 0,01 |
| 9335, 9869, 9870 (borderôs 19254/19255/19256) | borderô vivo ≠ finalizado (ou ausente) ⇒ alocação **não consumida**; `nosso = mnyTitPermutar/taxa − valorAlocado` |
| 10307 (borderô 14944, `fin=2`) | idem, não consumida |
| Todos os adtos com execução real `settled`/`parcial` (~128) | classificação `consumida(vivo)` concorda com `abateu` em 100%. Os 2 (+1) casos da ADR com `fin=1` e sem abate precisam de razão nomeada (finalizado depois da última ingestão, estorno não refletido ou permuta fora do painel) ⇒ **EXPLICADO**; sem razão ⇒ **DIVERGENTE (P0)** |

### V2. Prioridade dos motivos e tolerância (Fix 2 + Fix 3): `ElegibilidadeService` com detalhe e declarações ao vivo

| Amostra | Esperado |
|---|---|
| 43 INOX com execução real `settled` hoje em `data-base-indisponivel` | `JA_PERMUTADO` / `ja-permutado` (pago ≤ R$1, `valorPermutar ≤ R$1`, `valorPermutado > 0`) |
| 28 resíduos `permuta-manual` (10208, 10571, 10865, 11286, 11296, 12884, 17081, 17286, 17292, 17872, 17873, 17890, 17901, 17927, 17930, 20434, 21145, 21147, 23111, 24162, 24164, 25783, 25895, 7639, 7646, 9879 + restantes da query da entrevista) | `mnyTitPermutar ≤ R$1,00` ao vivo ⇒ `JA_PERMUTADO` (não roteado para permuta-manual) |
| 8721 (COPPER, proc 124) | `mnyTitAberto` = R$ 0,02 ⇒ `pago=true`; motivo **≠ `nao-pago`** |
| 3754, 20418, 5885, 21841, 4576 (resíduos R$ 21,01 / 327,10 / 1.472,06 / 1.621,34 / 2.175,86) | `mnyTitAberto > R$1,00` ⇒ `BLOQUEADA/nao-pago` |
| 50 não pagos hoje `data-base-indisponivel` (amostra ≥ 10) | `BLOQUEADA/nao-pago` |
| Adto pago, com saldo > R$1 e sem D.I (amostra ≥ 5, incluindo cliente-filtro) | não filtro: `BLOQUEADA/data-base-indisponivel`; filtro: `PERMUTA_MANUAL/cliente-filtro` |

Se o valor vivo mudou desde a entrevista (ex.: o resíduo foi saneado no ERP), a linha vira
**EXPLICADO** com o valor observado. A regra é avaliada sobre o valor vivo, nunca sobre o da entrevista.

### V3. Fronteira da tolerância
Não há documento real exatamente em R$ 1,00 / R$ 1,01. Fica **SEM_GROUND_TRUTH** declarado. Coberto
pelos testes unitários da Task 1 (R$ 1,00 ⇒ sem saldo/pago; R$ 1,01 ⇒ com saldo/não pago).

### Critério de PASS
Todas as linhas de V1 e V2 são EXATO, OK_CENTAVO ou EXPLICADO (com razão), e V3 fica documentado como
SEM_GROUND_TRUTH. Qualquer DIVERGENTE não explicado = gate vermelho (P0): re-loop ou InfoGapBroker.
