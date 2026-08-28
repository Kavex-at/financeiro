---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-integrability
generated_at: 2026-08-28T16:17:00Z
scope: backend
score: 6
findings_count: 7
cards_count: 7
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time do Conexos (mudança de wire — renomeia/remove `titMnyTotPago` ou drift em `com308.finTituloFin`) | POST `com308/financeiroAPagar/list/{docCod}` passa a rejeitar o `fieldList` (400/500) ou omite silenciosamente o novo campo | `ConexosTitulosClient.listTitulosAPagar` e todos os seus 4 consumidores (`EleicaoPermutasService` × 3 caminhos, `AlocacaoPermutasService`, `ReconciliacaoPermutaService`) | Produção, ingestão diária de Permutas (cron `financeiro-ingest-permutas`, novo cron do delta) | Falha DETECTÁVEL num único ponto: Zod na row do `com308` rejeita, a chamada quebra, `IngestaoPermutas` marca a run como `error` e o hidratador cai no piso conservador (`pago=false`, invoice permanece visível) — sem contaminar `valor/taxa negociada` | Blast radius ≤ 1 método (`listTitulosAPagar`); MTTR de detecção ≤ 24h via probe-em-CI ou primeira run diária; 0 UPSERT com dados semanticamente errados |

O delta atual **melhora** o cenário no eixo "detecção" (ground-truth 30/30 na sonda, 80/80 no validator) mas **piora** no eixo "cost of upgrade": adiciona mais um campo obrigatório num `fieldList` explícito que este mesmo repo já viu quebrar (`ORA-00904` histórico em `mnyTitAberto`/`mnyTitPermutar`/`moeEspSigla`, `ConexosFinanceiroClient.ts:406-413`) — sem a rede de segurança do Zod nem probe em CI que perceba a regressão antes do usuário.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Consumidores de `ConexosTitulosClient.listTitulosAPagar` (blast radius) | 4 (`EleicaoPermutasService.ts:551,606,839`, `AlocacaoPermutasService.ts:142`, `ReconciliacaoPermutaService.ts:379`, `EleicaoPermutasService.ts:883-884` par adto/inv) | ≤ 6 (aceitável) | ✅ | `grep -rn "listTitulosAPagar" src/backend` |
| Campos wire acoplados no `fieldList` explícito de `listTitulosAPagar` | 7 (`titCod`, `titFltTaxaMneg`, `titMnyValorMneg`, `titMnyValor`, `titMnyTotPago`, `moeCodMneg`, `moeEspNome`) | ≤ 5 ou `fieldList: []` | ⚠️ | `ConexosTitulosClient.ts:245-256` |
| Rows do `com308` validadas por Zod (`com308RowSchema`) | 0 usos em produção (schema definido em `conexosPermutasSchemas.ts:41`, mas `grep` não encontra `.parse\|safeParse` em `ConexosTitulosClient.ts`) | 100% do caminho `listTitulosAPagar` | ❌ | `grep -c "safeParse\|\.parse(" src/backend/domain/client/ConexosTitulosClient.ts` = 0 |
| Cobertura Zod em clients Conexos irmãos | 10 de 12 clients usam `.parse`/`.safeParse` no boundary | ≥ 80% | ✅ | `grep -rln "\.safeParse\|\.parse(" src/backend/domain/client/*.ts \| grep -v test` |
| Contract test com fixture da wire real do `titMnyTotPago` | 2 asserts unitários (com mock inline em `ConexosSubClients.test.ts:969,990`) | Fixture HAR + probe em CI | ⚠️ | `grep -c "titMnyTotPago" src/backend/domain/client/ConexosSubClients.test.ts` = 2 |
| Probes/validators contra PRD versionados no repo | 24 probes + 8 validators (uma pasta inteira `src/backend/jobs/`) | ≥ 1 por integração crítica | ✅ | `ls src/backend/jobs/probe-*.ts \| wc -l` = 24 |
| Probes/validators executados em CI | 0 (`grep validate-.*-v1 .github/` sem match; `package.json` sem `job:validate:*`) | ≥ 1 (`validate-invoice-pago-detalhe-v1` roda contra HML no CI) | ❌ | `grep -rn "validate-.*-v1\|job:validate" .github/ src/backend/package.json` |
| Constantes de tenant (`titVldStatus`) extraídas de `conexosPermutasConstants.ts` | Não — `'titVldStatus#EQ': '1'` está inline no `ConexosTitulosClient.ts:257` | Igual às demais (`TPD_PROFORMA`, `ADIANTAMENTO_FILTER_KEY`, `VLD_STATUS_FINALIZADO`) | ⚠️ | `ConexosTitulosClient.ts:257` vs `conexosPermutasConstants.ts` |
| Versionamento explícito da URL/serviço Conexos | Nenhum — `serviceName='com308.finTituloFin'` sem versão | Header `X-Api-Version` ou `/v1/`  quando o provedor suportar | ⚠️ | `grep -n "serviceName\|X-Api-Version" src/backend/domain/client/ConexosTitulosClient.ts` |
| Enum `pago` do `com308` decodificado | Não — valores 1/2/3 observados (21/2/7 numa amostra de 30) e ignorados; derivação usa identidade monetária | Decodificação registrada em `conexosPermutasConstants.ts` (P3) | ⚠️ | `ontology/integrations/conexos.md:37` (gap `com308-enum-pago`) |
| Caminhos de leitura da INVOICE que consumem `listTitulosAPagar` e aplicam `derivarPagoDosTitulos` | 1 (`hidratarInvoiceNegociada`) — o único caminho que alimenta `permuta_invoice` (persistência). `fetchInvoicesBatched:521-575` não aplica, mas produz a lista efêmera de casadas usada na UI da candidata — não persiste. | Documentar assimetria ou aplicar nos dois caminhos | ⚠️ | `grep -n "derivarPagoDosTitulos" src/backend/domain/service/permutas/EleicaoPermutasService.ts` = linhas 103, 620 |
| Semântica `undefined` vs `0` (parseOptionalNumber) | Corretamente distinguidos: `null/''` → `undefined`; `0` legítimo → `0` (`ConexosBaseClient.parseOptionalNumber`), `derivarPagoDosTitulos` propaga a distinção com `titulos.some(t.valorPago === undefined) → undefined` | Igual | ✅ | `EleicaoPermutasService.ts:107-112` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosTitulosClient` expõe métodos de domínio (`listTitulosAPagar`, `getDetalheTitulos`, `listBaixasTitulo`); consumidores não conhecem `serviceName`/`fieldList`. | ✅ presente | `ConexosTitulosClient.ts:230-287` |
| Use an Intermediary | `ConexosBaseClient` centraliza `paginate`/`callList`/`ensureSid`/`runWithRetry`/`parseOptionalNumber`/`isPago` para todos os sub-clients Conexos. | ✅ presente | `ConexosBaseClient.ts:228-292, 351-374` |
| Restrict Communication Paths | Todos os consumidores acessam via `@inject(ConexosTitulosClient)` — nenhum service usa `axios`/`fetch` direto contra o Conexos (esperado nos 4 pontos que consomem `listTitulosAPagar`). | ✅ presente | `EleicaoPermutasService.ts:1-40`, `AlocacaoPermutasService.ts:1-40` |
| Adhere to Standards | Zod nos boundaries em 10/12 clients Conexos; `ConexosTitulosClient` **não** aderiu — o `com308RowSchema` foi ampliado neste delta mas ninguém o aplica. | ❌ ausente | `conexosPermutasSchemas.ts:41-53` definido, `grep -c "safeParse\|\.parse(" ConexosTitulosClient.ts` = 0 |
| Abstract Common Services | Constantes de tenant Columbia estão em `conexosPermutasConstants.ts` (TPD_PROFORMA, ADIANTAMENTO_FILTER_KEY, VLD_STATUS_FINALIZADO); `titVldStatus#EQ '1'` **ficou inline** neste delta. | ⚠️ parcial | `ConexosTitulosClient.ts:257` vs `conexosPermutasConstants.ts:16` |
| Discover Service | Config via `EnvironmentProvider` (`CONEXOS_BASE_URL`, `CONEXOS_USERNAME`, `CONEXOS_FIL_COD`) com `sync: false` no `render.yaml` — cutover PRD/HML sem redeploy. | ✅ presente | `render.yaml:57-79, 96-133` |
| Tailor Interface | Mapper isola o wire (`titMnyTotPago` → `valorPago`); mudança de nome no ERP só toca o mapper. Mas o `fieldList` explícito inverte parcialmente: se o campo sumir, o mapper nem chega a rodar (chamada quebra antes). | ⚠️ parcial | `ConexosTitulosClient.ts:275-283` (mapper OK) vs `:245-256` (fieldList explícito) |
| Configure Behavior | `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`/`SISPAG_LIVE_WRITE_ENABLED` como kill-switch por env; **não há** kill-switch para o "novo caminho de `pago`" — se `derivarPagoDosTitulos` demonstrar drift, só é possível reverter via revert de commit + redeploy. | ⚠️ parcial | `render.yaml:31-45, 65-70` |
| Manage Resources | `BoundedConcurrency` limita fan-out do `listTitulosAPagar` (`ADIANTAMENTOS_CONCURRENCY=10`) para não estourar `LOGIN_ERROR_MAX_SESSIONS`. | ✅ presente | `EleicaoPermutasService.ts:83, 316, 546-570` |
| Orchestrate | `EleicaoPermutasService` orquestra 3 caminhos de hidratação da invoice (`fetchInvoicesBatched`, `hidratarInvoiceNegociada`, par adto/inv em `883-884`) — cada um chamando `listTitulosAPagar`. Apenas **um** (`hidratarInvoiceNegociada`) aplica a correção do `pago`. | ⚠️ parcial | `EleicaoPermutasService.ts:521, 584, 883-884` |
| Manage Resource Coupling | `catch {}` silencioso em todos os call-sites do `listTitulosAPagar` (`EleicaoPermutasService.ts:563, 622, 858`, `AlocacaoPermutasService.ts:149`) — desacopla mas degrada silenciosamente sem métrica per-endpoint de falha. | ⚠️ parcial | mesmo grep |
| Contract testing | Asserts unitários com mock inline no `ConexosSubClients.test.ts` (2 novos testes que cobrem `titMnyTotPago`); ground-truth em `validate-invoice-pago-detalhe-v1.ts` (80/80 na sonda 2026-08-28); **nenhum roda em CI** — só à mão contra HML/PRD. | ⚠️ parcial | `ConexosSubClients.test.ts:969-1000`, `jobs/validate-invoice-pago-detalhe-v1.ts` sem entrada em `.github/` |
| Versioning strategy | Ausente: `serviceName='com308.finTituloFin'` sem cabeçalho de versão; qualquer breaking change do ERP quebra o cliente sem aviso. Provedor não publica changelog de wire. | ❌ ausente | `ConexosTitulosClient.ts:239-242, 258` |
| Backward-compatibility shims | Fallback conservador (`derivarPagoDosTitulos` devolve `undefined` sem títulos/sem campos → `pago` fica no piso `false`; `catch {}` no consumer). Cobre o modo "ERP quebrou" mas mascara o modo "ERP mudou silenciosamente para semântica diferente" (`titMnyTotPago` legítimo `0` vs ausência). | ✅ presente | `EleicaoPermutasService.ts:103-112, 606-627` |
| Observability of integration failures | `logService.warn/error` em falhas de fetch e `capHit`; **não há** métrica agregada por endpoint (taxa de 400/500 do `com308`, contagem de rows sem `titMnyTotPago`, contagem de `pago=undefined` por run). O `catch {}` engole a falha por invoice. | ❌ ausente | `EleicaoPermutasService.ts:305-311, 858`, `AlocacaoPermutasService.ts:149-151` |

## 4. Findings (achados)

### F-integrability-1: `com308RowSchema` é decorativo — o boundary de wire mais recém-adicionado não é validado

- **Severidade**: P1
- **Tactic violada**: Adhere to Standards / Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:243-286`; `src/backend/domain/client/permutas/conexosPermutasSchemas.ts:41-53`
- **Evidência (objetiva)**:
  ```
  $ grep -c "safeParse\|\.parse(" src/backend/domain/client/ConexosTitulosClient.ts
  0
  $ grep -n "conexosPermutasSchemas\|com308Row\|Com308Row" src/backend/domain/client/ConexosTitulosClient.ts
  (vazio)
  # Comparativo: ConexosSispagClient valida rows do fin064:
  $ grep -c "safeParse\|\.parse(" src/backend/domain/client/ConexosSispagClient.ts
  9  (ex.: `ConexosSispagClient.ts:224 tituloRowSchema.safeParse(row)`)
  # e 10/12 clients Conexos irmãos usam Zod:
  $ grep -rln "\.safeParse\|\.parse(" src/backend/domain/client/*.ts | grep -v test | wc -l
  11
  ```
- **Impacto técnico**: o delta amplia `com308RowSchema` com `titMnyTotPago: wireNumber.optional()` mas o mapper de `listTitulosAPagar` **não** aplica o schema — usa `parseOptionalNumber` cru sobre `r.titMnyTotPago`. Se o Conexos passar a devolver `titMnyTotPago` como `"1,23"` (locale-BR) ou um objeto envelope (`{value: 123}`), o mapper devolve `undefined` silenciosamente e a derivação vira "não sei" → `pago=false` para invoices efetivamente quitadas — o mesmo modo de falha que este PR corrige, agora com casca nova.
- **Impacto de negócio**: reintrodução do bug relatado pela Simone (aba "Invoices em aberto" com lixo) sem sinal de alarme — a detecção depende de reclamação da analista, não de um erro em log.
- **Métrica de baseline**: 0 rows do `com308` validadas por Zod hoje; alvo 100% (paridade com `com298RowSchema` que é aplicado em `ConexosFinanceiroClient.ts:286, 343`).

### F-integrability-2: `fieldList` explícito com 7 campos amplia o blast radius de uma quebra no `com308`

- **Severidade**: P1
- **Tactic violada**: Limit Dependencies (Encapsulate) / Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:245-256`
- **Evidência (objetiva)**:
  ```
  ConexosFinanceiroClient.ts:398-415 (fieldList: []) já documenta:
    // `com298/list` rejeita várias colunas via Oracle `ORA-00904 invalid identifier`
    // quando explicitamente listadas (campos de joins/agregados como `mnyTitAberto`,
    // `mnyTitPermutar`, `moeEspSigla`) e via HTTP 500 `Field 'pago' not found on model`
    // (virtuais). O payload default já carrega tudo que precisamos.

  ConexosTitulosClient.ts:245-256 vai NO SENTIDO OPOSTO:
    fieldList: ['titCod','titFltTaxaMneg','titMnyValorMneg','titMnyValor',
                'titMnyTotPago','moeCodMneg','moeEspNome']
  ```
- **Impacto técnico**: se o Conexos remover/renomear QUALQUER um dos 7 campos, a chamada inteira responde 400/500 — **matando taxa/valor negociado e o novo `pago`** de uma vez. Quebra em cascata em `EleicaoPermutasService` (3 call-sites: `fetchInvoicesBatched`, `hidratarInvoiceNegociada`, e o par adto/invoice em `883-884`), `AlocacaoPermutasService.ts:142`, `ReconciliacaoPermutaService.ts:379`. Todos os call-sites são `try/catch{}` silencioso — a falha vira degradação invisível.
- **Impacto de negócio**: em produção, uma quebra no `com308` derruba (a) VariaçãoCambial (taxa `undefined`), (b) aba "Invoices em aberto" com `pago` estagnado no piso, (c) Alocação (`valorNegociado`), (d) Reconciliação de baixa. 4 features degradam silenciosamente numa única falha wire, dependendo de um relato humano para diagnosticar.
- **Métrica de baseline**: blast radius = 4 caminhos independentes num único endpoint `POST com308/financeiroAPagar/list/{docCod}`; 0 métrica per-endpoint de falha.

### F-integrability-3: sem probe/validator em CI, o ground-truth só é medido à mão

- **Severidade**: P2
- **Tactic violada**: Contract testing / Discover Service (regressão detectada em desenvolvimento, não em produção)
- **Localização**: `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts:1-110`, `src/backend/jobs/probe-invoice-pago.ts:1-255`, `.github/workflows/ci.yml`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "validate-invoice-pago\|job:validate\|npm.*probe" .github/ src/backend/package.json
  (sem match — não roda em CI)
  $ ls src/backend/jobs/probe-*.ts | wc -l
  24
  $ ls src/backend/jobs/validate-*.ts | wc -l
  8
  ```
- **Impacto técnico**: 24 sondas + 8 validators versionados (excelente prática) mas nenhum é gate. `validate-invoice-pago-detalhe-v1.ts` só prova a correção porque o Yuri rodou à mão no dia 2026-08-28 (80/80). No próximo drift do Conexos, ninguém repete a leitura até a analista reclamar.
- **Impacto de negócio**: janela de detecção de drift no wire = "próximo relato de usuário" (foram 2 meses entre a chegada da ADR-0014 em 24-06 e o relato da Simone em 25-08 no bug análogo).
- **Métrica de baseline**: 0 validators executados em CI vs 8 versionados no repo.

### F-integrability-4: `derivarPagoDosTitulos` aplicado em 1 de 3 caminhos que chamam `listTitulosAPagar` no mesmo service

- **Severidade**: P2
- **Tactic violada**: Orchestrate (assimetria de comportamento entre call-sites que orquestram a mesma dependência)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:521-575` (fetchInvoicesBatched — não aplica), `:584-628` (hidratarInvoiceNegociada — aplica), `:879-892` (par adto/inv — não aplica; usa somaValorNegociado apenas)
- **Evidência (objetiva)**:
  ```
  $ grep -n "derivarPagoDosTitulos" src/backend/domain/service/permutas/EleicaoPermutasService.ts
  103:export const derivarPagoDosTitulos = (
  620:            const pagoDosTitulos = derivarPagoDosTitulos(tit);

  # E os outros dois call-sites do listTitulosAPagar no mesmo service:
  $ grep -n "listTitulosAPagar" src/backend/domain/service/permutas/EleicaoPermutasService.ts
  551:  const tit = await this.conexosTitulosClient.listTitulosAPagar(...)   # fetchInvoicesBatched
  606:  const tit = await this.conexosTitulosClient.listTitulosAPagar(...)   # hidratarInvoiceNegociada (aplica)
  839:  const titAdto = await this.conexosTitulosClient.listTitulosAPagar(...) # variacao 1:1
  883,884:  this.conexosTitulosClient.listTitulosAPagar(...) x2               # par adto/inv
  ```
- **Impacto técnico**: `hidratarInvoiceNegociada` (usado em `todasInvoicesPorFilial:295`) É o caminho que persiste em `permuta_invoice` — logo a correção efetivamente entrega o resultado prometido. Mas `fetchInvoicesBatched` produz o `pago` do lado-crédito das candidatas casadas (`fetchInvoicesBatched:544 → mapped.pago = i.pago`, list-derived) — se algum consumidor futuro passar a persistir/exibir esse `pago` (regra é "efêmero na candidata" hoje), o bug volta pela porta ao lado. A assimetria não está documentada in-code.
- **Impacto de negócio**: aumento do custo de manutenção — próximo desenvolvedor precisa reconstruir o raciocínio "qual caminho persiste, qual não" para não regredir. Já aconteceu (a evidência de 2026-06-18 sobre PROFORMA foi generalizada indevidamente para INVOICE, gerando ESTE bug).
- **Métrica de baseline**: 1 de 3 call-sites do mesmo service aplicam `derivarPagoDosTitulos`; 0 comentários in-code que expliquem por que os outros não.

### F-integrability-5: constante de wire `titVldStatus#EQ '1'` inline — regride a política do repo

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/client/ConexosTitulosClient.ts:257`; contraste com `src/backend/domain/client/permutas/conexosPermutasConstants.ts:1-38`
- **Evidência (objetiva)**:
  ```
  ConexosTitulosClient.ts:257
    filterList: { 'titVldStatus#EQ': '1' },

  conexosPermutasConstants.ts já centraliza os irmãos:
    TPD_PROFORMA = 99, TPD_INVOICE = 128, VLD_STATUS_FINALIZADO = ['3'],
    ADIANTAMENTO_FILTER_KEY = 'docVldTipoAdto#EQ', ADIANTAMENTO_FILTER_VALUE = 1
  ```
- **Impacto técnico**: outro tenant (outra trading, `priCod ≠ 1153`) recalibra o `titVldStatus`; hoje o valor vive inline num sub-client — Inviolable Rule #2 violada em espírito. Como o valor `'1'` decide quais títulos ENTRAM na soma face-vs-pago, um valor de status diferente numa outra instalação silenciaria a derivação exatamente como o bug corrigido.
- **Impacto de negócio**: fricção no roadmap SaaSo ("uma conta AWS por cliente" — CLAUDE.md) — cada novo tenant obriga a caçar valores em código, não em `conexosPermutasConstants.ts`.
- **Métrica de baseline**: 1 constante wire inline no delta; alvo 0 (todas em `conexosPermutasConstants.ts`).

### F-integrability-6: enum `pago` do `com308` observado (1/2/3) e não decodificado

- **Severidade**: P3
- **Tactic violada**: Tailor Interface / Adhere to Standards
- **Localização**: `ontology/integrations/conexos.md:37` (gap `com308-enum-pago`); `src/backend/domain/client/ConexosTitulosClient.ts:245-256` (não pede `pago` no fieldList)
- **Evidência (objetiva)**:
  ```
  ontology/integrations/conexos.md:37
    "com308-enum-pago (P3) — o com308 expõe um campo `pago` que NÃO é booleano
     (valores 1/2/3 observados: 21/2/7 numa amostra de 30). Significado de cada
     valor não decodificado; a derivação em uso é a identidade monetária, provada."

  ontology/_inbox/invoice-pago-detalhe-tasks.md:41
    "NÃO usar sem evidência do significado de cada valor; a identidade
     monetária está provada."
  ```
- **Impacto técnico**: o cliente ignora o campo autoritativo e reconstrói a informação via soma. Se num futuro tenant a soma falhar (tolerância/moeda), não há o campo enum como cross-check.
- **Impacto de negócio**: baixo — a derivação está validada 80/80; é dívida técnica de conhecimento, não bug latente.
- **Métrica de baseline**: 1 gap aberto (`com308-enum-pago`) sem sonda dedicada.

### F-integrability-7: `catch {}` silencioso em todos os call-sites — sem observability per-endpoint

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures / Manage Resource Coupling
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:563, 622-627, 858`; `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:149-151`
- **Evidência (objetiva)**:
  ```
  EleicaoPermutasService.ts:562-565 (fetchInvoicesBatched)
     } catch {
         // com308 indisponível p/ esta invoice — segue sem valor negociado.
     }

  EleicaoPermutasService.ts:622-627 (hidratarInvoiceNegociada — o CAMINHO CORRIGIDO)
     } catch {
         // com308 indisponível p/ esta invoice — segue sem valor negociado e com
         // `pago` no piso conservador (`false`): a invoice continua visível na aba
         // em vez de sumir sem prova de quitação.
     }

  AlocacaoPermutasService.ts:149-151
     } catch {
         // com308 indisponível — segue sem valor/taxa negociada.
     }
  ```
- **Impacto técnico**: cada `catch {}` é uma pastilha de "degradar em vez de falhar". Boa política localmente, ruim globalmente: não há contador de "quantas invoices caíram no piso hoje". Um drift do `titMnyTotPago` que atinja 100% das rows fica indistinguível de "0% falhou" sem instrumentação. O `LogService.warn`/`error` existe (`logService.warn` é usado em `capHit:305`), mas não é chamado nesses catches.
- **Impacto de negócio**: retomada do padrão que gerou este bug — decisão tomada sobre "quantas invoices realmente estão pagas" sem alarme quando o insumo desapareceu.
- **Métrica de baseline**: 4 `catch {}` sem `logService`; alvo: `logService.warn({ type:BUSINESS_WARN, endpoint:'com308/financeiroAPagar/list', docCod, filCod })` em todos, com contador agregado por run no `EleicaoResult`.

## 5. Cards Kanban

### [integrability-1] Aplicar `com308RowSchema` no mapper de `listTitulosAPagar`

- **Problema**
  > `com308RowSchema` foi ampliado neste delta (`+ titMnyTotPago`) mas continua decorativo — `ConexosTitulosClient.listTitulosAPagar` não o importa nem invoca. Uma mudança silenciosa do wire (locale, envelope, tipo) devolve `undefined` em `parseOptionalNumber` e reintroduz o bug corrigido, sem qualquer log de alarme. O irmão `ConexosSispagClient` já usa `tituloRowSchema.safeParse` em cada row do `fin064` — este cliente ficou para trás.
- **Melhoria Proposta**
  > Aplicar `com308RowSchema.safeParse(r)` no `.map` dentro de `listTitulosAPagar` (`ConexosTitulosClient.ts:268-286`). Row inválida → `logService.warn` (`BUSINESS_WARN`, endpoint + docCod + issues) e ignorar (mesma política de `ConexosSispagClient.ts:224-227`). Zero impacto no happy path; ganho: qualquer drift de tipo/nome vira aviso no log da run diária de ingest-permutas.
- **Resultado Esperado**
  > 100% das rows do `com308` passam por Zod antes do mapper; contador `rowsRejeitadas` por endpoint disponível no run.log.
- **Tactic alvo**: Adhere to Standards / Tailor Interface
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Rows validadas por Zod em `listTitulosAPagar`: 0 → 100%
  - Clients Conexos com Zod no boundary: 10/12 → 11/12
- **Risco de não fazer**: drift silencioso no `titMnyTotPago` (renome/locale/envelope) faz o bug do `pago` voltar por baixo, indistinguível de "invoice em aberto"; detecção depende novamente de relato humano.
- **Dependências**: nenhuma.

### [integrability-2] Contratar `titMnyTotPago` como opcional e cair para `getDetalheTitulos` quando ausente

- **Problema**
  > `listTitulosAPagar` agora depende de `titMnyTotPago` no `fieldList` explícito. Este repo tem histórico documentado (`ConexosFinanceiroClient.ts:406-413`) de colunas que o Oracle rejeita via `ORA-00904 invalid identifier` quando listadas — foi por isso que `mnyTitAberto`/`mnyTitPermutar`/`moeEspSigla` foram removidas do `fieldList` do `com298`. Se `titMnyTotPago` cair na mesma armadilha, o `POST` volta 400/500 e derruba de uma vez o `pago` novo E a taxa/valor negociada (todos os 4 consumers do método).
- **Melhoria Proposta**
  > Duas camadas: (a) telemetria — logar `rowsSemTitMnyTotPago` por run (após F-integrability-1); (b) fallback tático — se ≥ X% das rows vier sem o campo, cair para `getDetalheTitulos({docCod})` para derivar `pago` a partir de `mnyTitAberto === 0` (o caminho já existente do Gate 3, `EleicaoPermutasService.ts:606-627`). Custo: +1 GET por invoice quando o path degradado dispara — só quando degrada.
- **Resultado Esperado**
  > Blast radius de uma quebra no `com308.finTituloFin` cai de 4 features (`pago` + taxa + `valorNegociado` + reconciliação de baixa) para 1 (só o novo `pago`, com fallback automático).
- **Tactic alvo**: Tailor Interface / Backward-compatibility shims
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-2, F-integrability-1
- **Métricas de sucesso**:
  - Blast radius de quebra no `com308`: 4 features → 1 feature (`pago` degradado com fallback)
  - Fallback observável: contador `pagoViaDetalheFallback` por run
- **Risco de não fazer**: uma mudança rotineira no schema do Conexos derruba VC + Alocação + Reconciliação simultaneamente, com detecção só quando um analista abrir chamado.
- **Dependências**: [integrability-1] (precisa da telemetria de row-inválida para o gatilho).

### [integrability-3] Rodar `validate-invoice-pago-detalhe-v1` como gate contra HML no CI

- **Problema**
  > O ground-truth (80/80 concordam contra `getDetalheTitulos`) só existe porque o Yuri rodou o validator à mão em 2026-08-28. Nenhum dos 8 validators versionados em `src/backend/jobs/validate-*.ts` roda em CI ou schedule — logo o próximo drift do Conexos não é detectado até a analista reclamar (janela histórica: 2 meses entre a ADR-0014 em 24-06 e o relato em 25-08).
- **Melhoria Proposta**
  > Adicionar um GitHub Action opcional `smoke-conexos-hml` (workflow_dispatch + schedule diário) que rode `validate-invoice-pago-detalhe-v1` + os validators críticos contra HML (`CONEXOS_BASE_URL=…-hml`, sem `PROBE_ALLOW_PRD`). Amostra pequena (`N=30`). Falha 1× por dia → issue automática. Não bloqueia PR.
- **Resultado Esperado**
  > Janela de detecção de drift no wire cai de "próximo relato de usuário" para ≤ 24h.
- **Tactic alvo**: Contract testing / Discover Service
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Validators executados em pipeline (CI/schedule): 0 → ≥ 3 (invoice-pago, gate-3-pago, valor-negociado)
  - Tempo até detecção de drift: dias/semanas → ≤ 24h
- **Risco de não fazer**: repositório acumula 30+ probes/validators "para uso futuro" sem cadência real de execução; ROI da instrumentação evapora.
- **Dependências**: credenciais HML já disponíveis (headers do CONEXOS_BASE_URL do render.yaml comprovam que HML existe e é a base de cutover — `render.yaml:56`).

### [integrability-4] Documentar in-code qual caminho da `EleicaoPermutasService` persiste `pago` e por que só ele aplica a correção

- **Problema**
  > 3 call-sites do `listTitulosAPagar` no mesmo service (`fetchInvoicesBatched:551`, `hidratarInvoiceNegociada:606`, par adto/inv `883-884`) e só um aplica `derivarPagoDosTitulos`. A assimetria é intencional (só `hidratarInvoiceNegociada` alimenta `permuta_invoice`, os outros produzem estruturas efêmeras/candidatas), mas não há comentário in-code que explique a escolha. Foi exatamente esse tipo de suposição não-marcada ("o list traz `mnyTitAberto`") que gerou este bug 2 meses após a ADR-0014.
- **Melhoria Proposta**
  > Docblock explícito no cabeçalho de `fetchInvoicesBatched` e do par adto/inv marcando "este caminho NÃO persiste `pago`; a correção de 2026-08-28 vive só em `hidratarInvoiceNegociada` — se você começar a persistir daqui, aplique `derivarPagoDosTitulos` também". Complementar com um teste `.test.ts` que documente o contrato ("`fetchInvoicesBatched` produz `pago` a partir da row do list — não é fonte de verdade").
- **Resultado Esperado**
  > Próximo desenvolvedor lê o docblock antes de reusar; teste segura o contrato explícito.
- **Tactic alvo**: Orchestrate / Encapsulate
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Call-sites do `listTitulosAPagar` com docblock explicando papel: 1/3 (o corrigido) → 3/3
  - Teste de contrato "fetchInvoicesBatched não persiste `pago`": 0 → 1
- **Risco de não fazer**: em 3 meses, um `/feature-tweak` que reusa `fetchInvoicesBatched` para popular uma tela nova reintroduz o bug sem sinal.
- **Dependências**: nenhuma.

### [integrability-5] Instrumentar `catch {}` silencioso com `logService.warn` + contador por run

- **Problema**
  > Todos os 4 call-sites do `listTitulosAPagar` engolem exceção com `catch {}` (`EleicaoPermutasService.ts:563, 622, 858`, `AlocacaoPermutasService.ts:149`). Boa política local (degradar em vez de falhar) mas apaga o sinal — não há como saber se hoje 3 invoices ou 800 caíram no piso. Um drift no wire que atinja 100% das rows fica indistinguível de "0% falhou".
- **Melhoria Proposta**
  > Substituir `catch {}` por `catch (err) { await this.logService.warn({ type: LOG_TYPE.INTEGRATION_DEGRADED, message: 'listTitulosAPagar caiu no piso conservador', data: { endpoint: 'com308/financeiroAPagar/list', docCod, filCod, error: String(err) } }); }`. Adicionar `pagoNoPisoConservador` como contador no `EleicaoResult`. Alarme se > X% num run.
- **Resultado Esperado**
  > 0 falhas "invisíveis" — toda degradação do `com308` deixa rastro em log/métrica.
- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-7, F-integrability-2
- **Métricas de sucesso**:
  - Call-sites com `catch {}` sem log: 4 → 0
  - Contador `pagoNoPisoConservador` no `EleicaoResult`: ausente → presente
- **Risco de não fazer**: dívida de observabilidade se acumula; próximo drift do wire fica invisível.
- **Dependências**: nenhuma.

### [integrability-6] Extrair `titVldStatus#EQ '1'` para `conexosPermutasConstants.ts`

- **Problema**
  > O filtro `filterList: { 'titVldStatus#EQ': '1' }` está inline em `ConexosTitulosClient.ts:257`. Os irmãos (`TPD_PROFORMA`, `TPD_INVOICE`, `VLD_STATUS_FINALIZADO`, `ADIANTAMENTO_FILTER_KEY`) já vivem em `conexosPermutasConstants.ts` justamente porque outro tenant recalibra os IDs. Inviolable Rule #2 violada em espírito e regressão do próprio padrão do repo.
- **Melhoria Proposta**
  > Adicionar `TITULO_VLD_STATUS_ATIVO = '1' as const` em `conexosPermutasConstants.ts` com docblock apontando o gap `titVldStatus` documentado no ontology/integrations/conexos.md; substituir o inline. Enquanto isso, adicionar um comentário no site explicando por que só `status=1` entra na soma face-vs-pago.
- **Resultado Esperado**
  > 0 constantes de wire de tenant Columbia inline em `src/backend/domain/client/`; SaaSo-ready.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Constantes de wire de tenant inline em clients: 1 → 0
- **Risco de não fazer**: cada novo tenant obriga a caçar valores em código; onboarding SaaSo mais caro.
- **Dependências**: nenhuma.

### [integrability-7] Sondar semântica do enum `pago` do `com308` (1/2/3)

- **Problema**
  > `com308` expõe um campo `pago` que NÃO é booleano (valores 1/2/3 observados: 21/2/7 numa amostra de 30). Significado não decodificado. Gap `com308-enum-pago` (P3) em `ontology/integrations/conexos.md:37`. A derivação atual (identidade monetária) está validada 80/80, mas o campo autoritativo do ERP fica no escuro — sem cross-check.
- **Melhoria Proposta**
  > Sonda dedicada (`jobs/probe-com308-enum-pago.ts`, mesmo padrão dos 24 probes existentes): (a) cruzar `pago ∈ {1,2,3}` com a identidade `mnyTitValor − mnyTitTotPago === 0` numa amostra > 500; (b) capturar a distribuição por status. Se decodificado, adicionar como cross-check em `derivarPagoDosTitulos` (assert paranóico com log). Se semântica ambígua, registrar como decidido-em-aberto.
- **Resultado Esperado**
  > Gap `com308-enum-pago` resolvido (RESOLVIDO ou explicitamente ACEITO); documentação da wire completa.
- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - Gaps abertos em `ontology/integrations/conexos.md`: 3 → 2
- **Risco de não fazer**: campo autoritativo do ERP continua não usado; um dia a soma falha por motivo cambial/tolerância e não temos plano B.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: apenas o DELTA da branch `fix/invoice-pago-detalhe` (11 arquivos, +756/-2). Findings gerais de arquitetura Conexos (`ConexosBaseClient`, `legacyConexosAdapter`, dual-auth Supabase+NextAuth) foram avaliados nas runs anteriores e não são regressão deste delta — não repito.
- Cross-QA: F-integrability-1 (Zod não aplicado no boundary) sobrepõe **Security** (validação de input) e **Fault-Tolerance** (degradação silenciosa) — flagear com o consolidator. F-integrability-2 (blast radius do `fieldList`) sobrepõe **Fault-Tolerance / Availability** (uma falha no `com308` degrada 4 features). F-integrability-4 (assimetria orquestrada) sobrepõe **Modifiability** (o mesmo código que ofende Integrability ofende Modifiability).
- Não medível localmente: taxa real de erro 4xx/5xx do `com298`/`com308` em PRD (requer log agregado do Render); frequência de rows sem `titMnyTotPago` na população real (requer instrumentação a ser adicionada — ver card 1/5).
- O delta acerta o mais importante: derivação booleana estrita, semântica `undefined vs 0`/`false` consistente com a decisão `residual-pago-centavos`, ground-truth medido 30/30 na sonda e 80/80 no validator, fallback conservador que preserva "invoice em aberto" quando o dado falta. As melhorias propostas são sobre a **rede de segurança** ao redor da correção, não sobre a correção em si.
