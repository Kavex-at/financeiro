# Tasks: sispag-ajuste-centavos

**Spec source:** `ontology/_inbox/sispag-ajuste-centavos-interview.md` (respostas do maintainer D1–D7, P0-1..3, P1) + `ontology/_inbox/sispag-ajuste-centavos-ontology-diff.md` (M1–M9 aprovados) + ontologia v0.45.0 (commit dcf6a5e, `planned`)
**Ontology diff:** yes (já aplicado, `implementation_status: planned`) — `ontology/decisions/0074-sispag-ajuste-centavos-por-renegociacao-fin070.md`, `ontology/business-rules/ajuste-centavos-titulo-sispag.md` (I18a–n), `ontology/actions/sispag/ajustar-centavos-titulo.md`, emendas em `business-rules/vinculo-codbar-item-sispag.md` (I17b régua líquida, I17d nota, I17m guarda do `.REM`, I17n import pelo líquido), `business-rules/sugestao-boleto-dda-sispag.md` (I15g transferência), `entities/decisao-sugestao-boleto.md` (`tipoAnulacao`, `origemDecisaoId`, `transferidaPor`), `actions/sispag/finalizar-lote.md` (`TitleAdjustmentInProgressError`), `actions/sispag/confirmar-sugestao-boleto.md`, `integrations/conexos.md` (seção de escrita `fin070`/`fin103`)
**entity_changed:** true (`DecisaoSugestaoBoleto` ganha `tipoAnulacao`/`origemDecisaoId`/`transferidaPor`; ledger novo de execução, padrão I-2; sem entidade nova)
**Estimated scope:** XL (backend ~16 arquivos novos/alterados + 1 migration + 3 rotas + frontend ~4 arquivos + 3 jobs de verificação: sonda PRD só leitura de permissão, medição PRD só leitura, prova HML de escrita)
**Mode:** `/feature-tweak`. Estende `ConexosSispagWriteClient`, `BoletoSuggestionService`, `LotePagamentoService`, `RemessaService`, `RemessaCnabValidator`, `ElegibilidadeVinculoCodigoBarras`; serviço novo `AjusteCentavosTituloService`.
**Entrega:** o código sobe com modo **`off`** como default em todas as filiais. Nada nesta PR liga `on` em PRD (G5 exige go explícito do maintainer, depois do merge).

## Decisões fechadas (não reabrir)

- **D1:** o valor do boleto é a verdade. Δ > 0 ⇒ `frnVldTpop 1` (juros); Δ < 0 ⇒ `frnVldTpop 2` (desconto); `frnMnyValor = |Δ|`.
- **D3:** elegível só com `0 < |Δ| ≤ LIMITE_VALOR_MESMO_DIA` (R$ 0,05, a constante da I15c, **sem constante nova**) **e** número igual (dígitos estritos, I15f) **e** par `VIGENTE` **e** mesmo vencimento (data civil UTC meia-noite).
- **D4 / I18e:** reaprova só o bloqueio que a nossa renegociação criou, com `titMnyTotal == valorBoleto` e exatamente um comando ativo "APROVAR"; o resto vira `aguardando_aprovacao_manual`.
- **P0-1 / I18f / M3:** identidade = sessão da credencial do ambiente do servidor (`CONEXOS_USERNAME` → `env.conexosLogin`), resolvida **fora** do caminho por-request do `ConexosSessionResolver`; nunca a analista, nunca job/cron. Login diferente do sondado (G1) ⇒ `shadow`.
- **P0-2 / I18g / M2:** disparo assíncrono logo **depois do commit** do `confirmar`; "tentar de novo"; varredura de retomada só no processo do servidor. Nunca em cron, nunca no `bootstrapAppContainer`, nunca na remessa.
- **P0-3 / I18k / M5:** `RASCUNHO` local ⇒ troca o item na transação do rechaveamento (`valor` = líquido novo, M6); `FINALIZADO`/`REMESSA_GERADA`/`RETORNADO` ou rascunho nativo ⇒ recusa e avisa; `finalizarLote` recusa lote com ajuste não terminal.
- **M1 / I18j:** transferência auditada (anula com `TITULO_RENEGOCIADO` pelo `sistema`; nova `CONFIRMADA` herda `decididoPor`/`decididoEm`, `origemDecisaoId`, `transferidaPor = 'sistema'`). CHECK da 0084 relaxado **só** para esse caso.
- **M4:** pagamento parcial (`totalPago > 0`) fica fora.
- **M7:** `shadow` faz leituras ao vivo no ERP, zero escrita.
- **M8 / I17m:** guarda do `.REM` nasce bloqueando (fail-closed), **depois** da medição só leitura de 30 dias de `.REM` de PRD; se houver caso legítimo, nasce `warn` e vira bloqueio por ADR curta.
- **M9 / G3:** cancelamento de renegociação não finalizada e reconhecimento pelo marcador são portão HML antes de `on`.
- **Escrita no ERP:** tentativa única (`postGenericOnce`/`putGenericOnce`); sucesso = estado **observado na releitura**; transitório antes do `finalizar` ⇒ compensação (cancelar), depois ⇒ só para a frente; retry com `RetryExecutor`, nunca `setTimeout`.
- **Privacidade:** código de barras só mascarado 5+4 em ledger, log, evento, obs do `fin070` e banco.

## Fatos do código que moldam as tasks (verificados em 2026-10-19 neste worktree)

- Última migration = **0086** (`0086_sispag_vinculo_codigo_barras.sql`); próxima = **0088**. Reconferir `origin/main` e branches abertas antes do ship.
- `RemessaService.ts:1379` monta o item com `Number(pendente.raw.titMnyValor ?? item.valor ?? 0)` — o bug da I17n (valor base, não líquido).
- `ElegibilidadeVinculoCodigoBarras.ts:57,134-137` compara com `totalAberto` (base); `VinculoCodigoBarrasService.ts:727-771` lê `totalAberto` ao vivo — ponto da emenda I17b (régua líquida, fail-closed na divergência das duas fórmulas).
- `RemessaService.ts:851-895` tem o gate de integridade pós-geração (`RemessaCnabValidator.validar` → `RemessaCorrompidaError` / `BoletoCodigoBarrasRepetidoError`); a I17m entra ali, com o mesmo tratamento tardio (I16b(2)).
- `ConexosSessionResolver.resolve` cai em `registry.robot()` fora de request e para usuário sem vínculo; publica identidade em `conexosRequestContext`. A sessão do servidor para a I18 deve vir de `ConexosSessionRegistry.robot()` **explicitamente** (com identidade `env.conexosLogin` gravada no ledger), sem passar pelo `resolve()` (que usaria a sessão da analista dentro da request do `confirmar`).
- Não existe hoje marcador de "processo do servidor": crons/jobs e o Express usam o mesmo `bootstrapAppContainer`. O marcador tem de ser ligado em `src/backend/index.ts` (boot do servidor, perto de `app.listen`, l.77–81), nunca no container (gotcha do CLAUDE.md).
- `SISPAG_BIND_CODBAR_FILIAIS` é lido em duas ocorrências do `EnvironmentProvider` (l.351 e l.452) e parseado em `domain/libs/boleto/ModoVinculoCodigoBarras.ts` (fail-closed). A flag nova segue o mesmo parser (extrair/reaproveitar, sem duplicar).
- `ConexosBaseClient` já expõe `postGenericOnce`/`putGenericOnce`. `ConexosSispagWriteClient` não tem nada de `fin070`/`fin103`/`fin106`.
- 0084: CHECK `sispag_decisao_sugestao_boleto_anulador_check` proíbe `anulada_por = 'sistema'`; CHECK `sispag_sugestao_boleto_evento_tipo_check` lista os tipos de evento (a 0086 já o alterou). Trilha do lote = `sispag_verificacao_evento` (CHECK de tipo na 0078).
- Ledgers com identidade (I-2): colunas `conexos_username`/`conexos_usn_cod TEXT` (0051), precedente `remessa_execucao` (0049).
- Rotas da sugestão: `routes/sispag.ts:854-990` (`/sugestoes-boleto/confirmar` em `sispag:executar`, limiter `buildSugestaoBoletoLimiter`).
- Frontend: `src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx`, `sugestaoBoleto.ts`, `VinculoCodigoBarrasSelo.tsx`, hook de abertura `useCarteiraAoAbrir.ts`.
- Probes HML com corpos de request que funcionaram: `src/backend/jobs/probe-hml-renegociacao-fin070.ts`, `probe-hml-vinculo-centavos.ts`; sonda PRD só leitura de permissão modelo: `probe-prd-readonly-permissao-fin015.ts` (avisa que o login derruba a sessão viva do robô — memória "probe local derruba sessão Conexos").

## Ground-truth plan (obrigatório: lógica monetária alimentada pelo Conexos)

**Status: PARCIAL.** Escrita **não** é ground-truthável em PRD: as provas de escrita (`fin070`, `fin103`, vínculo, `.REM`) existem só em HML (`sispag-centavos-hml-achados.md`: 536/1→536/2 juros, 540/1→540/2 desconto, `.REM` PG191074/PG191075 com J = barra). O `GroundTruthValidator` valida em PRD **só leitura**:

| # | O que | Fonte nativa | Amostra | Tolerância | Chave | Task |
|---|---|---|---|---|---|---|
| GT1 | Régua líquida I17b: `totalLiquido − totalPago` × `totalAberto + titMnyJuros − titMnyDesconto` | `fin064` ao vivo | todos os títulos BOLETO da carteira ativa (todas as filiais) + todos com `totalPago > 0` | 0 centavo (divergência = caso a tratar, não erro do validador) | `filCod/docCod/titCod` | Task 13 (G4) |
| GT2 | Semântica do líquido em pagamento parcial (P1-4) | `fin064` | todos com `totalPago > 0` | 0 centavo | idem | Task 13 (G4) |
| GT3 | I17m: barra (10 dígitos/100) × pagamento do J | `.REM` gerados em PRD, últimos 30 dias (`listarArquivosRemessa`/`baixarRemessa`, só leitura) | todos os J com barra > 0 | 0 centavo | `nomeArquivo/linha` | Task 13 (M8) |
| GT4 | I17n: `titMnyLiquido` × `titMnyValor` no grid de pendentes | `fin015` pendentes (só leitura) | pendentes de todas as filiais | 0 centavo | `docCod/titCod` | Task 13 |
| GT5 | `shadow` em PRD: candidatos I18a × levantamento de 2026-10-19 (109 NELSON +0,01; 0 entre 0,06 e 10) | `fin064` + decisões locais | todos os `AJUSTE_SIMULADO` | contagem exata, ajustada pelo que já foi pago | `docCod/titCod` | Task 16 (G5) |

**SEM_GROUND_TRUTH em PRD:** a sequência de escrita (I18c–e, I18h compensação, I18i reconhecimento) — coberta por G2/G3 em HML (Task 15) e pelo título real controlado (G5). **G1** (permissão do login do servidor para `fin070`/`fin103`) é sonda só leitura, Task 14.

## Task list

### Task 1: RED + GREEN — régua líquida da I17b no vínculo (base, vale com ajuste `off`)
**Files to change:**
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.ts`
- `src/backend/domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.test.ts`
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.ts` (leitura ao vivo do `fin064`, ≈ l.727–771)
- `src/backend/domain/service/sispag/VinculoCodigoBarrasService.test.ts`

**Acceptance criteria:**
- [ ] Testes escritos primeiro e falhando (RED comprovado no log da tarefa)
- [ ] Entrada passa de `totalAberto` a `{ totalLiquido, totalPago, totalAberto, titMnyJuros, titMnyDesconto }`; `abertoLiquido = totalLiquido − totalPago`, conferido contra `totalAberto + titMnyJuros − titMnyDesconto` em centavos inteiros
- [ ] Fórmulas divergentes ⇒ inelegível `VALOR_ABERTO_INDISPONIVEL`; qualquer campo ausente/não finito ⇒ idem (fail-closed)
- [ ] Caso canônico 5 (regressão): título sem juros/desconto/pagamento ⇒ resultado idêntico ao atual em todos os casos já existentes do arquivo de teste (nenhum teste anterior alterado na expectativa)
- [ ] Caso HML 536/2: base 53,53, juros 0,01, líquido 53,54 × barra 53,54 ⇒ elegível; × barra 53,53 ⇒ `VALOR_DIFERENTE` com Δ −1
- [ ] A mesma função é usada nos três pontos (elegibilidade, conferência pré-`PUT`, pós-releitura) — teste que espiona as três chamadas
- [ ] I17d(6): `itsMnyVlrPgtoResult == valorBoleto` continua o critério com juros/desconto do título ≠ 0 (teste com confirm 53,54)
- [ ] `typecheck` e `lint` ok

**Dependencies:** none

---

### Task 2: RED + GREEN — import do item pelo líquido (I17n, corrige bug)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts` (≈ l.1379, `montarItensImport`)
- `src/backend/domain/service/sispag/RemessaService.test.ts` (ou o arquivo de teste do import existente)
- `src/backend/domain/errors/NetValueUnavailableError.ts` + teste (409, motivo `VALOR_LIQUIDO_INDISPONIVEL`, `userMessage` pt-BR com `docCod/titCod`)
- Schema Zod do grid de pendentes no `ConexosSispagWriteClient` (`listarTitulosPendentes`): `titMnyLiquido`, `titMnyJuros`, `titMnyDesconto` opcionais e numéricos

**Acceptance criteria:**
- [ ] RED primeiro: payload de import com `titMnyLiquido = 462,50` e `titMnyValor = 462,49` leva `itsMnyValor = itsMnyVlrPgto = 462,50`
- [ ] `titMnyLiquido` ausente + juros/desconto 0/ausentes ⇒ usa `titMnyValor` (comportamento atual preservado)
- [ ] `titMnyLiquido` ausente + juros ou desconto ≠ 0 ⇒ item não importado, `NetValueUnavailableError` com motivo `VALOR_LIQUIDO_INDISPONIVEL`, sem chamada ao `importar`
- [ ] Nunca cai em `item.valor` (snapshot) quando o grid tem o título (teste dedicado)
- [ ] Vale para todo título, não só os ajustados (teste com título sem ajuste e com juros nativo)
- [ ] `typecheck`, `lint`, testes existentes do `RemessaService` verdes

**Dependencies:** none

---

### Task 3: RED + GREEN — guarda do `.REM` barra == pagamento do J (I17m)
**Files to change:**
- `src/backend/domain/libs/cnab/RemessaCnabValidator.ts` + `.test.ts` (novo campo `divergenciasValor` no resultado)
- `src/backend/domain/service/sispag/RemessaService.ts` (gate pós-geração, ≈ l.851–895)
- `src/backend/domain/errors/RemessaBarcodeAmountMismatchError.ts` + `.test.ts` (409)

**Acceptance criteria:**
- [ ] RED primeiro com fixtures de segmento J reais (layout dos `.REM` HML PG191074/PG191075): barra 462,50 e pagamento 462,50 ⇒ ok; barra 462,50 e pagamento 462,49 ⇒ divergência
- [ ] Barra com valor zerado (boleto de valor aberto) ⇒ fora da guarda
- [ ] Divergência ⇒ `RemessaBarcodeAmountMismatchError` com `docCod/titCod`, os dois valores e o código **mascarado 5+4**; `JSON.stringify` do erro e do log não contém 44 nem 47 dígitos
- [ ] Mesmo tratamento tardio da I16b(2): lote **não** vai a `REMESSA_GERADA`, `baixarArquivo` não serve, arquivo fica no ERP para cancelamento manual (teste espelhando o do `RemessaCorrompidaError`)
- [ ] Modo da guarda é uma constante tipada `GUARDA_VALOR_J = { BLOQUEIA, AVISA }` com default `BLOQUEIA`; o valor final é fixado pelo resultado da Task 13 (M8) **antes do merge** — se a medição achar caso legítimo, nasce `AVISA` (só `warn`) e a ADR curta fica como follow-up
- [ ] `lint`/`typecheck` ok

**Dependencies:** none (o default final depende da Task 13)

---

### Task 4: RED — elegibilidade pura do ajuste (I18a/I18b/I18m) e máquina de estados do ledger (I18h)
**Files to change:**
- `src/backend/domain/libs/boleto/ElegibilidadeAjusteCentavos.test.ts` (novo)
- `src/backend/domain/libs/boleto/ElegibilidadeAjusteCentavos.ts` (só contrato de tipos)
- `src/backend/domain/libs/boleto/EtapaAjusteCentavos.test.ts` (novo)
- `src/backend/domain/libs/boleto/EtapaAjusteCentavos.ts` (só constantes tipadas e assinatura)

**Acceptance criteria:**
- [ ] Elegibilidade: cada um dos 9 itens da I18a falso ⇒ inelegível com motivo distinto e tipado (`SEM_DECISAO_CONFIRMADA`, `PAR_NAO_VIGENTE`, `NUMERO_DIFERENTE`, `DELTA_ZERO`, `DELTA_ACIMA_LIMITE`, `VENCIMENTO_DIFERENTE`, `TITULO_NAO_APROVADO`, `TITULO_PAGO_OU_PARCIAL`, `JUROS_OU_DESCONTO_PREVIO`, `JA_AJUSTADO_NA_LINHAGEM`, `TITULO_EM_LOTE_FINALIZADO`, `TITULO_EM_RASCUNHO_NATIVO`, `MODO_NAO_ON`)
- [ ] Limite: Δ = ±0,05 elegível; Δ = ±0,06 inelegível (caso canônico 3); Δ = 0 inelegível (nada a ajustar); importa `LIMITE_VALOR_MESMO_DIA` de `RegraSugestaoBoleto` (teste falha se alguém criar constante paralela: o teste usa a constante importada)
- [ ] Número: dígitos estritos (I15f) — `"012294"` × `"12294"` conforme a regra existente; MSC nº 12294 com número igual e par **não** vigente ⇒ inelegível (caso canônico 4)
- [ ] Vencimento: fixture com offset São Paulo não desloca o dia (UTC meia-noite)
- [ ] Sentido (I18b): Δ +0,01 ⇒ `{ frnVldTpop: 1, frnMnyValor: 0.01 }`; Δ −0,01 ⇒ `{ 2, 0.01 }`; nunca `frnVldTpop 0` com valor
- [ ] `valorBoleto` vem da decodificação **nossa** da barra (`CodigoBarrasBoleto`), não do campo do DDA
- [ ] Máquina: transições válidas `pendente → renegociacao_criada → titulo_incluido → composicao_gravada → ajuste_aplicado → finalizada → (liberada | sem_bloqueio | aguardando_aprovacao_manual) → rechaveada → concluido`; terminais `concluido`, `concluido_sem_decisao`, `aguardando_aprovacao_manual`, `cancelado`, `recusado`, `indeterminado`, `simulado`; `antesDoFinalizar(etapa)` verdadeiro só até `ajuste_aplicado`; transição inválida lança
- [ ] Saída sem linha completa (`JSON.stringify` sem 44/47 dígitos)
- [ ] Testes **falham** antes da Task 5

**Dependencies:** none

---

### Task 5: GREEN — elegibilidade e máquina implementadas
**Files to change:**
- `src/backend/domain/libs/boleto/ElegibilidadeAjusteCentavos.ts`
- `src/backend/domain/libs/boleto/EtapaAjusteCentavos.ts`

**Acceptance criteria:**
- [ ] Task 4 verde; puro (sem I/O, sem log); classes exportadas, métodos arrow, modificadores explícitos
- [ ] Reusa a régua líquida da Task 1 (mesma função, não cópia) para Δ
- [ ] A mesma elegibilidade serve `shadow`, executor (início e antes do `finalizar`) e "tentar de novo"
- [ ] `typecheck`/`lint` ok

**Dependencies:** Task 1, Task 4

---

### Task 6: Modo por filial, login sondado e marcador de processo do servidor (I18f/I18l/M3)
**Files to change:**
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` (as duas ocorrências, junto de `SISPAG_BIND_CODBAR_FILIAIS`)
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/libs/boleto/ModoVinculoCodigoBarras.ts` (extrair o parser para reaproveitar, sem mudar comportamento) + `.test.ts`
- `src/backend/domain/libs/boleto/ModoAjusteCentavos.ts` + `.test.ts` (novo; `resolverModoEfetivo`)
- `src/backend/domain/libs/runtime/ServerProcessMarker.ts` + `.test.ts` (novo, `@singleton()`)
- `src/backend/index.ts` (liga o marcador no boot do servidor; **não** no `bootstrapAppContainer`)
- `DEPLOY.md` (envs novas, default `off`)

**Acceptance criteria:**
- [ ] Testes primeiro. `SISPAG_AJUSTE_CENTAVOS_FILIAIS`: mesmas regras de parse da I17k (`"on"` global, `"1:shadow,7:off"`, mistura `"on,1:off"` ⇒ `off`, inválido ⇒ `off` em tudo); default `off`
- [ ] `SISPAG_AJUSTE_CENTAVOS_LOGIN_SONDADO`: modo efetivo `on` exige igualdade (case-insensitive, trim) com `env.conexosLogin`; ausente ou diferente ⇒ `shadow` com `warn` pt-BR (M3)
- [ ] `sispagLiveWriteEnabled=false`, `conexosWriteEnabled=false` ou `conexosDryRun=true` ⇒ efetivo nunca `on` (no máximo `shadow`)
- [ ] Fora do processo do servidor (marcador desligado, ex.: job) ⇒ efetivo `shadow`, `warn` (caso canônico 12); credencial `conexosLogin` vazia ⇒ `shadow`
- [ ] Teste que importa `bootstrapAppContainer` e confirma que o marcador **não** é ligado por ele
- [ ] Constantes tipadas `MODO_AJUSTE = { OFF, SHADOW, ON }`; nenhum `process.env` fora do `EnvironmentProvider`
- [ ] Testes existentes de `ModoVinculoCodigoBarras` verdes sem mudança de expectativa

**Dependencies:** none

---

### Task 7: Migration 0088 (ledger, colunas da decisão, CHECKs, eventos) e paridade de build
**Files to change:**
- `src/backend/migrations/0088_sispag_ajuste_centavos.sql`
- `src/backend/migrations/0088_sispag_ajuste_centavos.test.ts`
- `src/backend/migrations/0088_sispag_ajuste_centavos.integration.test.ts`

**Acceptance criteria:**
- [ ] Reconferir o número livre em `origin/main` imediatamente antes de commitar (hoje 0088); se ocupado, renomear todos os artefatos e as referências da ontologia
- [ ] Tabela `sispag_ajuste_centavos_execucao`: `id`, `fil_cod`, `doc_cod`, `tit_cod_origem`, `decisao_id` (tipo da PK de `sispag_decisao_sugestao_boleto`), `tit_cod_novo`, `frn_cod`, `marcador` (único), `etapa` (CHECK com os valores da Task 4), `motivo`, `delta_centavos`, `frn_vld_tpop`, `valor_boleto_centavos`, `codigo_mascarado` (CHECK no formato 5+4 da 0085), `fbl_cod`, `conexos_username`, `conexos_usn_cod`, `tentativas`, timestamps
- [ ] Chave de idempotência única `(fil_cod, doc_cod, tit_cod_origem, decisao_id)`; **índice único parcial** "no máximo um não terminal por `(fil_cod, doc_cod, tit_cod_origem)`"
- [ ] `sispag_decisao_sugestao_boleto`: `tipo_anulacao TEXT NULL` (CHECK `MANUAL|PAR_REVOGADO|TITULO_RENEGOCIADO`, só em `ANULADA`), `origem_decisao_id NULL` (FK para a própria tabela), `transferida_por TEXT NULL` (CHECK `= 'sistema'` quando presente; os dois juntos ou nenhum)
- [ ] `anulador_check` relaxado: `anulada_por = 'sistema'` permitido **só** com `tipo_anulacao = 'TITULO_RENEGOCIADO'`; `unknown` continua proibido; decisão humana (`transferida_por IS NULL`) segue sem `sistema` em `decidido_por`
- [ ] `sispag_sugestao_boleto_evento_tipo_check` = tipos atuais (pós-0086) + `AJUSTE_SIMULADO`, `TITULO_RENEGOCIADO`, `DECISAO_TRANSFERIDA`, `AJUSTE_RECUSADO`, `AJUSTE_CANCELADO`, `AJUSTE_FALHOU`; trigger só-inclusão intacto
- [ ] `sispag_verificacao_evento` (trilha do lote): tipo `ITEM_TITULO_RENEGOCIADO` acrescentado ao CHECK
- [ ] Sem backfill (legado: `tipo_anulacao` nulo, derivado do motivo na leitura)
- [ ] Teste estático: `.sql` coberto por `MigrationFiles`/`copy-to-dist` (incidente 2026-09-23)
- [ ] Integração (Postgres de teste): anulação por `sistema` sem `TITULO_RENEGOCIADO` ⇒ erro; com ⇒ ok; dois ledgers não terminais para o mesmo título ⇒ erro; máscara com 44 dígitos ⇒ erro; tipos de evento novos aceitos, desconhecido recusado; reexecutar a migration é no-op

**Dependencies:** Task 4 (lista de etapas)

---

### Task 8: Client Conexos — `fin070`, `fin103`, `fin106` e leituras de `fin064` (tentativa única)
**Files to change:**
- `src/backend/domain/client/ConexosSispagWriteClient.ts` (ou `ConexosRenegociacaoClient.ts` novo, `@singleton() @injectable()`, se o arquivo atual passar do limite de tamanho)
- `src/backend/domain/client/ConexosSispagWriteClient.test.ts` (ou `.test.ts` do novo)
- `src/backend/domain/interface/sispag/RenegociacaoInterface.ts` (schemas Zod)

**Acceptance criteria:**
- [ ] Todos os métodos recebem a sessão **explicitamente** (`ConexosService` passado pelo chamador), nunca resolvem por `ConexosSessionResolver.resolve()`
- [ ] Escritas via `postGenericOnce`/`putGenericOnce`: `criarRenegociacao` (`POST fin070`: `pesCod`, `frnVldTipo 2`, `frnVldTpop 0`, `frnDtaReneg` = `BankingCalendar.todayBrt`, obs MAIÚSCULA com marcador), `incluirTitulo` (`POST fin070/titulos`), `gravarComposicao` (`POST fin070/titulos/composicao`: valor aberto, vencimento, `frgEspNumero`, `pgtCod`, `dupEspOrdem` do original), `aplicarAjuste` (`PUT fin070`: `frnMnyValor`, `frnVldTpop`), `finalizarRenegociacao` (`PUT fin070/finalizar/{frnCod}`), `cancelarRenegociacao` (rota a fixar por G3; até lá marcado `NotImplementedError` atrás de constante), `validarSelecionado`/`aplicarComando` (`fin103`)
- [ ] Corpos espelham exatamente os que funcionaram em `jobs/probe-hml-renegociacao-fin070.ts` (teste de snapshot do payload por caso juros e desconto)
- [ ] Leituras com Zod (`passthrough`, nullables explícitos): `lerRenegociacao` (inclui `mnyValorTotal`), `buscarRenegociacaoPorMarcador` (I18i), `listarTitulosDoDocumento` (`fin064`, para achar o título novo, I18d), `listarBloqueios` (`fin103/list`), `listarComandosDoBloqueio` (`fin106/finBloqCmd/list/{fblCod}`)
- [ ] Respostas de erro do ERP mapeadas para `ConexosError` com código preservado (`FIN_070.TIPO_OP_NAO_PERMITE_VALOR`, `FIN_070.O_TOTAL_DOS_TITULOS...`); classificação determinística × transitória exposta
- [ ] Nenhum método loga código de barras completo; obs leva só o mascarado
- [ ] `ConexosWriteDisabledError` quando `conexosWriteEnabled=false`, antes de qualquer chamada

**Dependencies:** none

---

### Task 9: Repositórios — ledger, transferência da decisão, carteira e troca do item (I18j em uma transação)
**Files to change:**
- `src/backend/domain/repository/sispag/AjusteCentavosExecucaoRepository.ts` + `.test.ts` + `.integration.test.ts` (novo)
- `src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts` + testes (`transferirDecisao`)
- `src/backend/domain/repository/sispag/TituloAPagarRepository.ts` + testes (`upsertTituloRenegociado`, `inativar`)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts` + testes (`trocarTituloDoItemEmRascunho`, `existeAjusteNaoTerminalNoLote`)

**Acceptance criteria:**
- [ ] SQL parametrizado (`$1…`), sem interpolação; todos `@injectable()`
- [ ] Ledger: `abrir` (write-ahead, conflito na chave única ⇒ devolve o existente), `registrarIntencao`/`registrarResultado` por etapa, `listarNaoTerminais(filCod?)`, `buscarConcluidoPorTitCodNovo` (I18a(7)), `ultimoPorTitulo` (para a UI); grava `conexos_username`/`conexos_usn_cod`
- [ ] `rechavear` executa numa **única transação**: (1) anula a decisão antiga com `TITULO_RENEGOCIADO`, `anulada_por = 'sistema'`, motivo "título renegociado X/Y → X/Z, frnCod N"; (2) insere a nova `CONFIRMADA` no título novo herdando `decidido_por`/`decidido_em`, `origem_decisao_id`, `transferida_por = 'sistema'` — **anula antes de inserir** (índices únicos I15l); (3) eventos `TITULO_RENEGOCIADO` e `DECISAO_TRANSFERIDA`; (4) upsert do título novo ativo + `ativo = false` no antigo; (5) itens em lote `RASCUNHO` trocam `tit_cod` e `valor` = líquido novo, `versao + 1`, evento `ITEM_TITULO_RENEGOCIADO`; (6) ledger a `rechaveada`
- [ ] Decisão já anulada pela analista ⇒ (1)/(2) não ocorrem, (4)/(5) sim, ledger `concluido_sem_decisao`
- [ ] Item em lote não `RASCUNHO` nunca é tocado (teste)
- [ ] O par `ConfirmacaoEmissorBoleto` não muda (teste)
- [ ] Integração: falha injetada no passo (5) desfaz (1)–(4) (rollback)

**Dependencies:** Task 7

---

### Task 10: RED — `AjusteCentavosTituloService` (casos canônicos 1–13)
**Files to change:**
- `src/backend/domain/service/sispag/AjusteCentavosTituloService.test.ts` (novo)
- `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts` (só assinatura)
- `src/backend/domain/errors/CentsAdjustmentIncompleteError.ts`, `CentsAdjustmentNotEligibleError.ts`, `TitleAdjustmentInProgressError.ts` + testes (409; `message` inglês, `userMessage` pt-BR)

**Acceptance criteria:**
- [ ] Um teste por caso canônico da I18 (1–13), com client/repos mockados: sequência exata de chamadas e payloads (caso 1 juros 0,01; caso 2 desconto 0,01)
- [ ] Caso 6: falha depois de `POST fin070/titulos` ⇒ `cancelarRenegociacao` chamado, releitura, ledger `cancelado`, nenhuma escrita no título; cancelamento falha ⇒ `indeterminado` + alerta, **nunca** segunda renegociação
- [ ] Conferência `mnyValorTotal == valorBoleto` antes do `finalizar`; diferente ⇒ não finaliza, cancela
- [ ] Elegibilidade recalculada ao vivo no início **e** antes do `finalizar`; inelegível na segunda ⇒ cancela
- [ ] I18d: zero ou dois candidatos a título novo ⇒ `indeterminado`, sem palpite
- [ ] I18e: bloqueio de outra regra, valor ≠ boleto, comando ausente/ambíguo, ou bloqueio remanescente ⇒ `aguardando_aprovacao_manual`; título novo sem bloqueio ⇒ `sem_bloqueio`; título original não aprovado ⇒ nem tenta liberar
- [ ] Casos 8/9 (I18i): retomada após `finalizar` não cria segunda renegociação; `POST fin070` sem resposta ⇒ acha `frnCod` pelo marcador e continua; `concluido` ⇒ no-op
- [ ] `shadow`: lê ao vivo, zero escrita (espião prova zero `*Once`), grava `AJUSTE_SIMULADO`
- [ ] Sessão usada = `ConexosSessionRegistry.robot()` explícita; teste prova que `ConexosSessionResolver.resolve` **não** é chamado mesmo dentro de contexto de request com analista vinculada
- [ ] Logs pt-BR, código mascarado; testes **falham** antes da Task 11

**Dependencies:** Task 5, Task 6, Task 8, Task 9

---

### Task 11: GREEN — `AjusteCentavosTituloService` (executor, compensação, retomada)
**Files to change:**
- `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts`
- (sem registro manual: o tsyringe resolve por autowiring como os demais serviços SISPAG; **nada** em `appContainer.ts`/`bootstrapAppContainer`)

**Acceptance criteria:**
- [ ] Task 10 verde; `@injectable()`, métodos arrow, `EnvironmentProvider` para tudo (nenhum `process.env`)
- [ ] Métodos públicos: `ajustar({ filCod, docCod, titCod, decisaoId, gatilho })`, `retomarPendentes({ filCod? })`, `listarCandidatos({ filCod })` (shadow/endpoint)
- [ ] Write-ahead: intenção gravada antes de cada chamada, resultado depois; retry só em leituras/transitórios via `RetryExecutor`
- [ ] Serialização por título: a varredura e o "tentar de novo" concorrentes não executam o mesmo ledger em paralelo (lock do ledger, `SELECT … FOR UPDATE SKIP LOCKED` ou advisory lock; teste)
- [ ] Todas as mensagens de log/erro ao operador em português; identificadores em inglês
- [ ] `typecheck`, `lint`, `test` verdes

**Dependencies:** Task 10

---

### Task 12: Gatilhos e guarda do lote — pós-commit do `confirmar`, "tentar de novo", varredura, `finalizarLote`
**Files to change:**
- `src/backend/domain/service/sispag/BoletoSuggestionService.ts` (+ teste: disparo **após** o commit, fora da transação, sem aguardar)
- `src/backend/domain/service/sispag/LotePagamentoService.ts` (`finalizarLote`, ≈ l.455) + teste
- `src/backend/routes/sispag.ts` (+ teste de rota)

**Acceptance criteria:**
- [ ] `confirmar` devolve a resposta sem esperar o ERP; o ajuste é agendado só depois do commit (teste: rollback do `confirmar` ⇒ nenhum ajuste disparado); erro do ajuste nunca muda a resposta do `confirmar`; só dispara com modo efetivo ≠ `off`
- [ ] `POST /sispag/ajustes-centavos/tentar-novamente` (`sispag:executar`, Zod no body, limiter) ⇒ `CentsAdjustmentNotEligibleError` com motivo quando inelegível
- [ ] `POST /sispag/ajustes-centavos/retomar` (`sispag:executar`) — chamado pela tela ao abrir; usuário só `sispag:ver` não dispara varredura (403 silencioso no front)
- [ ] `GET /sispag/ajustes-centavos?filCod=` (`sispag:ver`) — estado do ajuste por título e candidatos `shadow` (endpoint + log, M7)
- [ ] `finalizarLote` com item cujo título tem ledger não terminal ⇒ `TitleAdjustmentInProgressError` (409), caso canônico 11
- [ ] Nenhum gatilho em `jobs/`, cron ou `bootstrapAppContainer` (teste estático: grep de `AjusteCentavosTituloService` fora de `routes/`, `service/` e testes falha)
- [ ] PatternGuardian sem P0 no delta

**Dependencies:** Task 11

---

### Task 13: Ground truth PRD só leitura — régua líquida, pagamento parcial (G4), `.REM` 30 dias (M8), pendentes (I17n)
**Files to change:**
- `src/backend/jobs/validate-sispag-ajuste-centavos-v1.ts` (novo, **somente leitura**)
- `src/backend/jobs/validate-sispag-ajuste-centavos-v1.test.ts` (garante zero chamada de escrita: espião em `*Once`/`deleteGeneric`)
- `ontology/_inbox/sispag-centavos-hml-achados.md` (seção "PRD só leitura" com os números)

**Acceptance criteria:**
- [ ] GT1/GT2: conta títulos com fórmulas divergentes e títulos com `totalPago > 0`; registra se `totalLiquido` já desconta `totalPago` (P1-4); números no `_inbox`
- [ ] GT3 (M8): todos os `.REM` de PRD dos últimos 30 dias, cada J com barra > 0 comparado ao pagamento; resultado decide o default da Task 3 (`BLOQUEIA` se zero divergência legítima)
- [ ] GT4: pendentes com `titMnyLiquido ≠ titMnyValor` (tamanho do impacto da I17n)
- [ ] Roda com `databaseConnectionString=""` e sem contaminar a sessão do robô (memórias "sessão do robô contaminável" e "probe local derruba sessão"); executado fora do horário de remessa, com OK do maintainer
- [ ] Datas com `at time zone 'UTC'`; saída sem código completo
- [ ] **Bloqueia o merge** (G4 é antes do merge, P1-4)

**Dependencies:** Task 1, Task 2, Task 3 (para reusar régua e validador)

---

### Task 14: Portão G1 — sonda PRD só leitura de permissão `fin070`/`fin103` do login do servidor
**Files to change:**
- `src/backend/jobs/probe-prd-readonly-permissao-fin070-fin103.ts` + `.test.ts` (modelo: `probe-prd-readonly-permissao-fin015.ts`)

**Acceptance criteria:**
- [ ] Só leitura (`ger014` / matriz de permissão) para `fin070`, `fin103`, `fin106` e `fin064` do login `CONEXOS_USERNAME` configurado no servidor (Render), não do CLONEX
- [ ] Teste prova zero escrita; aviso explícito no topo de que o login derruba a sessão viva no cap de sessões; alternativa preferida documentada (pedir a matriz à Columbia/Conexos)
- [ ] Resultado registrado no `_inbox` com o login sondado — é o valor de `SISPAG_AJUSTE_CENTAVOS_LOGIN_SONDADO`
- [ ] Não bloqueia o merge; **bloqueia `on`**

**Dependencies:** none

---

### Task 15: Portões G2 + G3 — prova HML de escrita (vencimento passado/hoje, cancelamento, marcador)
**Files to change:**
- `src/backend/jobs/probe-hml-ajuste-centavos-g2-g3.ts` (novo; usa `hmlEnvFile.ts`; **somente HML**, recusa se a URL não for HML)
- `ontology/_inbox/sispag-centavos-hml-achados.md` (resultados)
- `ontology/integrations/conexos.md` (linha `cancelar` deixa de ser "não provado" com a rota real)

**Acceptance criteria:**
- [ ] Roda o `AjusteCentavosTituloService` de produção (não chamadas avulsas) contra HML, com o `ConexosSispagWriteClient` real
- [ ] G2: composição com vencimento **passado** e **de hoje** — aceita ou recusa registrada; recusa ⇒ ajuste vira `recusado` com motivo e a I18a ganha follow-up
- [ ] G3: renegociação criada e **não** finalizada é cancelada (`PUT fin070/cancelar/{frnCod}` ou `DELETE`), relida, título original intacto; a rota provada substitui o `NotImplementedError` da Task 8
- [ ] G3: `POST fin070` com resposta descartada de propósito ⇒ retomada acha o `frnCod` pelo marcador da obs
- [ ] Ponta a ponta de um caso juros e um desconto até `.REM` com J = barra e I17m passando
- [ ] Renegociações 3 e 4 existentes não são tocadas (P1-5); estado deixado em HML documentado
- [ ] Autorização explícita do maintainer antes de rodar (escrita em HML)

**Dependencies:** Task 11 (G3 também alimenta Task 8 `cancelarRenegociacao`)

---

### Task 16: Frontend — estado do ajuste na sugestão, "tentar de novo", varredura ao abrir
**Files to change:**
- `src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx` + `.test.tsx`
- `src/frontend/app/sispag/components/sugestaoBoleto.ts` + `.test.ts` (tipos, cliente da API)
- `src/frontend/app/sispag/components/AjusteCentavosSelo.tsx` + `.test.tsx` (novo, padrão do `VinculoCodigoBarrasSelo.tsx`)
- `src/frontend/app/sispag/useCarteiraAoAbrir.ts` (dispara `POST /retomar` só para `sispag:executar`)

**Acceptance criteria:**
- [ ] Testes primeiro. Modo `off` + par dentro do limite ⇒ "diferença de centavos — ajuste desligado"; em curso ⇒ "ajustando o título no Conexos"; `concluido` ⇒ título novo `X/Z` e **líquido** (do ledger), não `titMnyValor`; `aguardando_aprovacao_manual` / `recusado` / `cancelado` / `indeterminado` ⇒ aviso pt-BR com motivo e próxima ação
- [ ] Botão "tentar de novo" só para `sispag:executar` e estados retomáveis; desabilitado durante a chamada; erro 409 exibido com a `userMessage`
- [ ] Decisão transferida aparece com o autor humano original e a marca "transferida pelo sistema" (M1)
- [ ] Nada de código de barras completo na tela além do que já é exibido hoje
- [ ] Tokens/componentes do design system (`src/frontend/docs`); `npm run lint`/`typecheck`/`test` do frontend verdes
- [ ] **DesignSystemReviewer gate** aprovado

**Dependencies:** Task 12

---

### Task 17: Rollout G5 e fechamento documental (não-código após o merge, exceto docs)
**Files to change:**
- `ontology/business-rules/ajuste-centavos-titulo-sispag.md`, `ontology/actions/sispag/ajustar-centavos-titulo.md`, `business-rules/vinculo-codbar-item-sispag.md` (`implementation_status` → `implemented` nas partes entregues; I17m/I17n/I17b)
- `ontology/_index.json`, `ontology/_coverage.json`
- `CLAUDE.md` (Gotcha: "ajuste de centavos só no processo do servidor; nunca em job/cron/`bootstrapAppContainer`; `on` exige login sondado")
- `DEPLOY.md`

**Acceptance criteria:**
- [ ] Ontologia aponta para os arquivos reais (`related_files`) e `has_canonical_test: true` com o caminho do teste da Task 10
- [ ] Roteiro G5 escrito no `_inbox`: (a) `shadow` em PRD por filial, conferência dos `AJUSTE_SIMULADO` contra o levantamento (GT5); (b) **um** título NELSON real controlado com go explícito do maintainer, verificado no `fin064`, `fin103`, vínculo e `.REM`; (c) só então `on` na filial
- [ ] Checklist de pré-`on` registrado: G1 (Task 14) ✅, G2/G3 (Task 15) ✅, G4 (Task 13) ✅, I17m ativo, `SISPAG_AJUSTE_CENTAVOS_LOGIN_SONDADO` = login sondado
- [ ] Premissas com a Columbia (renegociação × correção do documento, conta contábil, usuário do `fin103`) listadas como pendências, não bloqueio
- [ ] ObservabilityAdvisor consultado sobre o fluxo assíncrono pós-commit e a varredura (logs estruturados por etapa, alerta para `indeterminado` e `aguardando_aprovacao_manual`)

**Dependencies:** Tasks 1–16

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend e frontend)
- [ ] `npm run lint` ✅ (backend e frontend)
- [ ] `npm test` ✅ (backend e frontend, incluindo integração das migrations)
- [ ] PatternGuardian gate ✅
- [ ] ontology diff em `ontology/` presente (v0.45.0, ADR-0074) e `implementation_status` atualizado ✅
- [ ] DesignSystemReviewer gate ✅ (Task 16)
- [ ] ObservabilityAdvisor review ✅ (fluxo assíncrono pós-commit e varredura; sem handler Lambda novo)
- [ ] Ground-truth: GT1–GT4 executados em PRD só leitura antes do merge (G4, M8); default da I17m fixado ✅
- [ ] Modo `off` como default comprovado em teste; nada liga `on` em PRD nesta PR ✅
- [ ] Regis-Review gate (reduzido por risco: fault-tolerance, integrability, security, testability) ✅
- [ ] Rebase de `main`; migration 0088, ADR 0074 e ontologia 0.45.0 reconferidos contra `origin/main` ✅
- [ ] app version bumped (FE+BE lockstep, minor: `feat`) à mão nos dois `package.json` (sem pwsh nesta máquina) + `CHANGELOG.md` ✅
