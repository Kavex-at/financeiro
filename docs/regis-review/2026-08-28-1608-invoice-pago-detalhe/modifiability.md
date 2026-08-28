---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-modifiability
generated_at: 2026-08-28T16:40:00-03:00
scope: backend
score: 5.5
findings_count: 6
cards_count: 5
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta `invoice-pago-detalhe`)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev de produto / analista financeira | Mudança **recorrente** e já triplamente reincidente na regra "o que é uma INVOICE/ADIANTAMENTO paga no Conexos": (a) o ERP passa a popular `mnyTitAberto` no `com298/list` e a lista volta a ser confiável; (b) mudança na tolerância de centavos (hoje `Σ face − Σ pago === 0` estrita, decidida em 2026-06-18 — `residual-pago-centavos`); (c) novo call-site que precisa decidir "esta invoice está quitada?" (ex.: aba de invoices canceladas, painel de aging, exportação de relatório). | Regra hoje espalhada em **3 call-sites** com **3 fontes de dado diferentes**: `EleicaoPermutasService.buildCandidata:665-670` (`getDetalheTitulos().pago` — Gate 3 do ADIANTAMENTO, 01b99bf); `AlocacaoPermutasService:129-135` (`getDetalheTitulos().pago` — invoice da alocação, df90fa6); `EleicaoPermutasService.hidratarInvoiceNegociada:617` (`derivarPagoDosTitulos(tit)` NOVO — invoice da ingestão do universo). Um quarto site, `ConexosBaseClient.isPago()`, continua vivo e é usado por `ConexosFinanceiroClient.ts:441,582` sobre a MESMA row inservível do `com298/list`. | Delta 48abd7b aplicado; 30/30 concordância validada em PRD filial 2 pelo `probe-invoice-pago` (2026-08-28). | A regra deveria caber em **1 lugar canônico** (uma função pura testada) consumida pelos 3 (ou 4) call-sites; qualquer mudança na tolerância ou na fonte de dado toca **um único arquivo**. | ≤ 1 arquivo por mudança na regra (hoje: **3** para a mudança já aplicada, e sobra o 4º trap em `isPago()`); ≤ 1 arquivo por novo call-site (hoje: cada site reimplementa a fórmula com uma fonte diferente). |

Cenário aplicado — **"e se o Conexos passar a popular `mnyTitAberto` no `com298/list` (fica confiável) e a Yuri decidir aceitar centavos de resíduo (`|face − pago| ≤ 0.02`)?"**: as duas mudanças combinadas obrigam a tocar `EleicaoPermutasService.ts:617` (fórmula), `EleicaoPermutasService.ts:665-670` (troca de fonte no Gate 3), `AlocacaoPermutasService.ts:129-135` (troca de fonte na alocação), `ConexosFinanceiroClient.ts:441,582` (decidir o que fazer com `isPago()`) e `ConexosBaseClient.ts:368-372` (definição da tolerância) — 5 arquivos, 4 sites de decisão, cada um com **suas próprias condições de curto-circuito** (`undefined` vs `false` vs piso conservador). Este é literalmente o defeito que este delta veio consertar (a correção de 01b99bf/df90fa6 não pegou o site novo criado depois pela ADR-0014).

Cenário sósia — **"nova aba de invoices canceladas precisa ler o estado real de quitação da fatura"**: hoje o dev precisa (i) achar as 3 (ou 4) implementações, (ii) decidir qual copiar, (iii) inventar sua própria estratégia de fallback quando o detail falha. O delta atual escolheu `undefined ⇒ piso conservador` (invoice permanece visível); os outros dois sites escolheram `catch ⇒ aberta = true`; `isPago()` faz `catch ⇒ false`. **Três políticas de fallback para a mesma pergunta.**

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Call-sites que decidem "invoice/adiantamento pago" | **4** (3 domain-service + 1 client-helper) | 1 função canônica + N chamadas | ❌ | `grep -rn "\.pago\|isPago\|derivarPagoDosTitulos" src/backend/domain --include='*.ts'` |
| Fontes de dado distintas para a mesma regra | **3** (`getDetalheTitulos().pago`, `derivarPagoDosTitulos(listTitulosAPagar)`, `isPago(rowCom298List)`) | 1 (ou 2 no máximo, com contrato explícito) | ❌ | grep + `ConexosBaseClient.ts:368-372` |
| Políticas de fallback distintas para a mesma regra | **3** (`undefined⇒piso`, `catch⇒aberta`, `catch⇒false`) | 1 política documentada | ❌ | `EleicaoPermutasService.ts:617,660`, `AlocacaoPermutasService.ts:135`, `ConexosBaseClient.ts:368-372` |
| Cognitive complexity — `EleicaoPermutasService.buildCandidata` (linha 660) | **65** (antes do delta: **65** — inalterado) | ≤ 15 (teto Biome) | ❌ | `npm run lint 2>&1 \| grep EleicaoPermutasService` (before e after) |
| Cognitive complexity — `EleicaoPermutasService.hidratarInvoiceNegociada` (linha 536) | **16** (antes do delta: **16** — inalterado) | ≤ 15 | ⚠️ | idem |
| LOC — `EleicaoPermutasService.ts` | **950** (antes: 909, +41) | ≤ 600 (Split Module) | ❌ | `wc -l src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| Nº de métodos — `EleicaoPermutasService` | 16 (2 public + 14 private) | ≤ 8 | ❌ | `grep -c '^\s*\(public\|private\) ' src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| LOC total — `domain/service/permutas/` (produção) | **6.808** em 16 services (11.098 c/ testes) | — (baseline) | ℹ️ | `wc -l src/backend/domain/service/permutas/*.ts \| grep -v test` |
| Fan-in — `EleicaoPermutasService` (importadores em produção) | **3** arquivos (`routes/permutas.ts`, `IngestaoPermutasService`, `ElegibilidadeService`) — baixo, aceitável | ≤ 5 | ✅ | `grep -rln "from '.*EleicaoPermutasService" src/backend --include='*.ts' \| grep -v test` |
| Fan-out (imports) — `EleicaoPermutasService.ts` | 21 imports | ≤ 15 | ⚠️ | `grep -c '^import ' src/backend/domain/service/permutas/EleicaoPermutasService.ts` |
| Warnings Biome `noExcessiveCognitiveComplexity` no repo | **20** (baseline pré-delta: **20**; delta não introduziu nem removeu warning) | 0 | ⚠️ | `npm run lint 2>&1 \| grep -c noExcessiveCognitiveComplexity` |
| Símbolos exportados no service só para teste/validador | **1** (`derivarPagoDosTitulos` — importado por `jobs/validate-invoice-pago-detalhe-v1.ts:7`) | 0 (extrair para módulo puro `pagoInvoice.ts`) | ⚠️ | `grep -rn "derivarPagoDosTitulos" src/backend --include='*.ts'` |
| Ontologia — `invoice.pago` tem regra canônica declarada | **Não** (entidade tem propriedade `pago` sem `business_rule` associada; a integração `conexos.md` narra o problema mas não vira invariante) | Regra canônica em `ontology/business-rules/` referenciando o único módulo de implementação | ❌ | `cat ontology/entities/invoice.md`, `cat ontology/integrations/conexos.md` |
| Tenants provisionados / módulos Terraform | ⚠️ Não medível — `infra/` não existe neste repo (deploy via Render blueprint) | — | ⚠️ | `ls infra 2>&1` (No such file or directory) |

### Apêndice — top-10 arquivos por LOC (backend, produção)

| # | LOC | Arquivo |
|---|---|---|
| 1 | 2.415 | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| 2 | 1.291 | `src/backend/domain/client/ConexosGerDocProcessoClient.ts` |
| 3 | 984 | `src/backend/routes/recebimentos.ts` |
| 4 | **950** | `src/backend/domain/service/permutas/EleicaoPermutasService.ts` **(TOCADO NESTE DELTA — +41)** |
| 5 | 919 | `src/backend/domain/service/sispag/RemessaService.ts` |
| 6 | 838 | `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` |
| 7 | 784 | `src/backend/routes/permutas.ts` |
| 8 | 703 | `src/backend/domain/client/ConexosFinanceiroClient.ts` |
| 9 | 663 | `src/backend/domain/interface/recebimentos/ports.ts` |
| 10 | 657 | `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts` |

### Apêndice — call-sites da regra "está pago?"

| # | Site | Arquivo:linha | Fonte de dado | Fórmula | Fallback |
|---|---|---|---|---|---|
| A | Gate 3 do ADIANTAMENTO | `EleicaoPermutasService.ts:665-670` | `getDetalheTitulos().pago` (via `mnyTitAberto === 0`) | boolean vindo do client | `catch ⇒ DETAIL_INDISPONIVEL` (candidata bloqueada) |
| B | Invoice na busca da ALOCAÇÃO manual | `AlocacaoPermutasService.ts:129-135` | `getDetalheTitulos().pago` | `aberta = det.pago !== true` | `catch ⇒ aberta = true` (mantém visível) |
| C | Invoice na INGESTÃO do universo (**NOVO**) | `EleicaoPermutasService.ts:606-623` | `listTitulosAPagar(com308)` + `derivarPagoDosTitulos(tit)` | `Σ valorBrl − Σ valorPago === 0` | `undefined ⇒ piso conservador (raw.pago do list = false)` |
| D | Row do `com298/list` (**inservível — TRAP**) | `ConexosFinanceiroClient.ts:441, 582` via `ConexosBaseClient.isPago()` (`ConexosBaseClient.ts:368-372`) | row do `com298/list` (`mnyTitAberto` null em 1146/1146 → sempre `false`) | `mnyTitAberto === 0 \|\| pago === 1` | `⇒ false` |

## 3. Tactics — Cobertura no financeiro (delta `invoice-pago-detalhe`)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `EleicaoPermutasService` continua monolítico (950 LOC, 16 métodos, orquestra fan-out multi-filial + build de candidata + Gate 3 + hidratação de invoice + casarInvoice); o delta adicionou a função pura `derivarPagoDosTitulos` no topo do arquivo — bom instinto, mas parou aí. | ❌ ausente | `wc -l src/backend/domain/service/permutas/EleicaoPermutasService.ts` → 950; grep de `^\s*(public\|private)` → 16 |
| **Increase Semantic Coherence** | Serviço mistura orquestração (o "job") com regras de domínio puras (`derivarPagoDosTitulos`, `somaValorNegociado`); a mesma regra "está pago?" está em 3 lugares — a coerência semântica está fragmentada. | ❌ ausente | `EleicaoPermutasService.ts:103-114` (função pura no meio do orquestrador); sites A/B/C em arquivos diferentes |
| **Encapsulate** | `ConexosBaseClient.isPago()` continua público e ainda usado por `ConexosFinanceiroClient.mapDocPagar` — o encapsulamento vazou: o consumidor sabe que precisa "corrigir com o detail depois", mas nada bloqueia o próximo dev de acreditar no boolean. | ⚠️ parcial | `ConexosBaseClient.ts:368-372`, `ConexosFinanceiroClient.ts:441,582` |
| **Use an Intermediary** | Não há um `InvoicePagoResolver` (ou serviço equivalente) que centralize a política de decisão + fallback. Cada site fala direto com o client. | ❌ ausente | grep confirma 3 sites falando direto com `conexosTitulosClient` |
| **Restrict Dependencies** | DDD é respeitado (Lambda→Service→Repo→Client, PatternGuardian ativo) — o delta não viola camadas. Mas a *dependência conceitual* ("todos dependem de saber como o Conexos sinaliza pago") não é restrita — está difusa. | ⚠️ parcial | Layout do repo mantido; conceito não isolado |
| **Refactor** | O delta faz um refactor tímido: extrai `derivarPagoDosTitulos` mas mantém o call-site A (Gate 3) e B (alocação) usando `getDetalheTitulos().pago` diretamente. Perdeu a chance de unificar. | ⚠️ parcial | diff 617ca3b..48abd7b em `EleicaoPermutasService.ts` (+41/-2) |
| **Abstract Common Services** | Não há serviço/módulo abstrato "InvoicePagoService" ou "TituloStatusService". A regra é reimplementada por call-site. | ❌ ausente | grep confirma |
| **Defer Binding (configuração/polimorfismo)** | Tolerância de centavos (`face − pago === 0` estrita) é **magic constant** embutida na função (`EleicaoPermutasService.ts:113`); mudar para `≤ 0.02` toca código, não config. `tsyringe` disponível mas nenhuma interface `InvoicePagoResolver` com múltiplas implementações. | ❌ ausente | `EleicaoPermutasService.ts:113`; grep `container.register` = 0 tokens nomeados novos no delta |

## 4. Findings (achados)

### F-modifiability-1: regra "invoice/adiantamento pago" duplicada em 3 sites com 3 fontes e 3 fallbacks

- **Severidade**: P1 (alto — cada mudança na regra ripa 3 arquivos; o defeito recém-corrigido é a terceira reincidência da MESMA classe)
- **Tactic violada**: Abstract Common Services · Increase Semantic Coherence
- **Localização**:
  - Site A (Gate 3 ADIANTAMENTO): `src/backend/domain/service/permutas/EleicaoPermutasService.ts:665-670`
  - Site B (Invoice na ALOCAÇÃO): `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:129-135`
  - Site C (Invoice na INGESTÃO — NOVO neste delta): `src/backend/domain/service/permutas/EleicaoPermutasService.ts:606-623` (`derivarPagoDosTitulos`)
- **Evidência (objetiva)**:
  ```
  # Site A (2026-06-18 — 01b99bf)
  detalhe = await this.conexosTitulosClient.getDetalheTitulos({ docCod, filCod });
  ... pago: detalhe.pago  # via mnyTitAberto === 0

  # Site B (2026-06-21 — df90fa6)
  const det = await this.conexosTitulosClient.getDetalheTitulos({ docCod: i.docCod, filCod });
  aberta = det.pago !== true;

  # Site C (2026-08-28 — 48abd7b, ESTE DELTA)
  const tit = await this.conexosTitulosClient.listTitulosAPagar({ docCod: i.docCod, filCod });
  const pagoDosTitulos = derivarPagoDosTitulos(tit);  # Σ valorBrl − Σ valorPago === 0
  if (pagoDosTitulos !== undefined) inv.pago = pagoDosTitulos;
  ```
- **Impacto técnico**: cada nova ADR que adiciona um consumidor da regra herda uma decisão explícita (qual das 3 fórmulas copiar? qual fallback?) e o histórico prova que **essa decisão é errada por omissão em 100% dos casos** — ADR-0014 criou o Site C e ele nasceu bugado exatamente porque o autor não lembrou de replicar 01b99bf/df90fa6.
- **Impacto de negócio**: a aba "Invoices em aberto" mostrou ~75% de invoices já liquidadas por semanas (relato Simone 2026-08-25) — analista perde tempo triando lixo, credibilidade do painel cai, decisão de permuta pode alocar contra invoice já paga se o Site A/B silenciar de outra forma no futuro.
- **Métrica de baseline**: 3 sites × 3 fontes × 3 políticas de fallback (medido acima); 1 reincidência já materializada em produção, cadência: bug-a-cada-3-meses (01b99bf → df90fa6 → 48abd7b).

### F-modifiability-2: `ConexosBaseClient.isPago()` continua sendo usado apesar de comprovadamente inservível para `com298/list`

- **Severidade**: P1 (alto — armadilha ativa para o próximo dev; método com nome positivo que sempre devolve `false`)
- **Tactic violada**: Encapsulate · Restrict Dependencies
- **Localização**:
  - Definição: `src/backend/domain/client/ConexosBaseClient.ts:368-372`
  - Usos em produção: `src/backend/domain/client/ConexosFinanceiroClient.ts:441` (`listFinanceiroAPagarByGerNum` — hidratação de DocFinanceiroAPagar) e `src/backend/domain/client/ConexosFinanceiroClient.ts:582` (`mapDocPagar` — reuso em outros paths)
- **Evidência (objetiva)**:
  ```typescript
  // ConexosBaseClient.ts:368-372
  public isPago = (row: Record<string, unknown>): boolean => {
      if (typeof row.mnyTitAberto === 'number') return row.mnyTitAberto === 0;
      if (typeof row.pago === 'number') return row.pago === 1;
      if (typeof row.pago === 'boolean') return row.pago;
      return false;
  };
  // Sonda probe-invoice-pago (2026-08-28, PRD filial 2):
  // com298/list retorna mnyTitAberto=null em 1146/1146 INVOICEs
  // ⇒ isPago(rowCom298List) === false, SEMPRE.
  ```
- **Impacto técnico**: chamadas `mapDocPagar` alimentam `DocFinanceiroAPagar.pago` — se qualquer serviço/rota tratar esse boolean como confiável, tem o mesmo defeito que este delta veio corrigir. Nome do método (`isPago`) promete o que o método não pode entregar sobre esta fonte.
- **Impacto de negócio**: a próxima feature que consumir `DocFinanceiroAPagar.pago` sem ler o comentário-armadilha em `EleicaoPermutasService.ts:594-598` reintroduzirá o incidente. O comentário é a "correção documentada"; o código não força — modifiability zero.
- **Métrica de baseline**: 2 call-sites em produção (`ConexosFinanceiroClient.ts:441,582`); 0 testes que exigem `isPago(rowCom298List) === true` (validariam a inutilidade); 1146/1146 nulls medidos em PRD.

### F-modifiability-3: `EleicaoPermutasService` continua god-object (950 LOC, 16 métodos, cognitive-complexity 65)

- **Severidade**: P2 (médio — o delta **não piorou** a complexidade — antes e depois: 65 no `buildCandidata`, 16 no `hidratarInvoiceNegociada` — mas herdou uma seam ainda maior)
- **Tactic violada**: Split Module · Increase Semantic Coherence
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts` (arquivo inteiro; foco em `buildCandidata:660` e `hidratarInvoiceNegociada:536`)
- **Evidência (objetiva)**:
  ```
  # Métricas AFTER delta 48abd7b
  wc -l EleicaoPermutasService.ts   → 950
  grep -c '^\s*(public|private) '   → 16 métodos
  biome lint noExcessiveCognitiveComplexity:
    EleicaoPermutasService.ts:536  → complexity 16 (limite 15)
    EleicaoPermutasService.ts:660  → complexity 65 (limite 15)  ← >4x o teto

  # Comparativo BEFORE delta 617ca3b (mesmo arquivo, git checkout):
    EleicaoPermutasService.ts:509  → complexity 16
    EleicaoPermutasService.ts:621  → complexity 65
  # Conclusão: complexidade INALTERADA; delta só empurrou linhas.
  ```
- **Impacto técnico**: cada nova feature que toca `buildCandidata` ou `hidratarInvoiceNegociada` paga o custo de 65/16 pontos de cognitive complexity — este é o site onde o próximo bug de invoice-pago vai reincidir se a extração não vier junto.
- **Impacto de negócio**: velocidade de mudança regride: o próprio commit-log mostra 3 correções em 10 semanas na mesma classe de defeito, todas encolvidas nesta seam.
- **Métrica de baseline**: cognitive complexity 65 (buildCandidata) — 4.3× o teto Biome; LOC 950 — 58% acima do alvo 600.

### F-modifiability-4: `derivarPagoDosTitulos` exportado só para o validador — mistura camadas de teste e produção

- **Severidade**: P2 (médio — vaza um símbolo de produção só para consumo out-of-band)
- **Tactic violada**: Split Module (função pura pertence a módulo próprio, não ao service orquestrador)
- **Localização**:
  - Definição: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:103-114`
  - Consumo out-of-band: `src/backend/jobs/validate-invoice-pago-detalhe-v1.ts:7` (`import { derivarPagoDosTitulos } from '../domain/service/permutas/EleicaoPermutasService.js'`)
- **Evidência (objetiva)**:
  ```typescript
  // Comentário do próprio delta explica a razão:
  // "Importa a função de produção em vez de reimplementar a regra:
  //  um validador que reescreve a fórmula valida a si mesmo."
  // — validate-invoice-pago-detalhe-v1.ts:20
  ```
  O reflexo (não repetir) é CORRETO; a **localização** é errada — a função pura vive no meio de uma classe orquestradora, o que empurra o consumidor a `import`-ar do serviço só pela named export.
- **Impacto técnico**: qualquer next consumer da regra (ex.: um novo relatório, uma migration de re-cálculo) também vai `import { derivarPagoDosTitulos } from '.../EleicaoPermutasService.js'` — o service vira o container implícito da regra, cimentando o god-object.
- **Impacto de negócio**: baixo hoje (1 job); alto se virar padrão — cada import extra da service class arrasta sua dependência transitiva de `tsyringe`, do `Conexos*Client` etc., para consumidores que só queriam a função pura.
- **Métrica de baseline**: 1 import out-of-band hoje; a função tem **zero testes unitários próprios** — só é exercitada indiretamente via testes de `hidratarInvoiceNegociada` (`EleicaoPermutasService.test.ts:945-1063`).

### F-modifiability-5: tolerância de centavos (`face − pago === 0` estrita) é magic constant, não config

- **Severidade**: P2 (médio — a regra é uma decisão de negócio explícita — 2026-06-18, `residual-pago-centavos` — mas está cravada em código)
- **Tactic violada**: Defer Binding · Abstract Common Services
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:113` (`return face - pago === 0;`)
- **Evidência (objetiva)**:
  ```typescript
  return face - pago === 0;   // magic 0 — nenhuma const, nenhum epsilon, nenhuma env
  ```
- **Impacto técnico**: mudar para "aceitar R$0,02 de resíduo" (decisão que já ficou em cima da mesa em 2026-06-18) obriga recompilar, redeployar e — mais grave — replicar a decisão nos sites A e B se eles evoluírem para a mesma fórmula.
- **Impacto de negócio**: regras contábeis mudam sem aviso; se a Columbia decidir que resíduos < 1 centavo contam como quitados, é feature-tweak completo em vez de rotação de config.
- **Métrica de baseline**: 1 magic constant crítica (`=== 0`); 0 configurações externalizadas para tolerância de reconciliação em `EnvironmentProvider`.

### F-modifiability-6: ontologia não possui `business-rule` canônica para `invoice.pago`

- **Severidade**: P3 (baixo — não bloqueia mudança, mas remove a rede-de-segurança do OntologyCurator)
- **Tactic violada**: Restrict Dependencies (a regra é entidade-domínio, deveria estar na ontologia como single-source)
- **Localização**: `ontology/entities/invoice.md` (declara `pago` como propriedade sem regra); `ontology/integrations/conexos.md` (narrativa do problema, sem virar invariante); `ontology/business-rules/` (**nenhuma regra `invoice-pago-derivation`**)
- **Evidência (objetiva)**:
  ```yaml
  # ontology/entities/invoice.md — properties:
  properties:
    - pago              # <-- mera declaração; sem business_rule associada
  ```
- **Impacto técnico**: quando o próximo `/feature-new` propuser um novo consumidor da regra, o OntologyCurator não tem invariante para exigir single-owner. O ciclo se repete.
- **Impacto de negócio**: baixo (indireto).
- **Métrica de baseline**: 0 business-rules referenciando `invoice.pago`; 3 call-sites de produção reimplementam a regra.

## 5. Cards Kanban

### [modifiability-1] Centralizar a regra "invoice/adiantamento está pago?" em um único módulo canônico

- **Problema**
  > A regra "quando é que uma invoice/adiantamento conta como pago no Conexos" está em 3 call-sites de produção (`EleicaoPermutasService.buildCandidata:665`, `AlocacaoPermutasService:129`, `EleicaoPermutasService.hidratarInvoiceNegociada:606-623`) com 3 fontes de dado (`getDetalheTitulos().pago`, `derivarPagoDosTitulos(listTitulosAPagar)`, `isPago(rowCom298List)`) e 3 políticas de fallback distintas (`DETAIL_INDISPONIVEL`, `aberta=true`, `piso conservador=raw.pago`). É a **terceira reincidência** da mesma classe de defeito (01b99bf 2026-06-18 → df90fa6 2026-06-21 → 48abd7b 2026-08-28), sempre com o mesmo padrão: uma correção pontual num site, outro site que nasce depois herda o bug. A vista "Invoices em aberto" mostrou ~75% de invoices já liquidadas por semanas (relato Simone) até este delta.

- **Melhoria Proposta**
  > Extrair um módulo `src/backend/domain/service/permutas/invoicePagoResolver.ts` (função pura, sem `@injectable` — é a regra, não um serviço com estado) com API `resolver({ getDetalhe, listTitulos, rowList }) → { pago: boolean | undefined, fonte: 'detail' | 'titulos' | 'list', razao?: string }`. Consolida as 3 fórmulas, expõe fallback DOCUMENTADO (preferir detalhe, cair para títulos, nunca acreditar no list), e devolve `undefined` explícito quando nenhuma fonte é confiável. Migrar os 3 call-sites (`EleicaoPermutasService.buildCandidata:665`, `AlocacaoPermutasService:129-135`, `EleicaoPermutasService.hidratarInvoiceNegociada:606-623`) para consumir o resolver — a política de "o que fazer com `undefined`" fica em cada call-site (é decisão de exibição), mas a fórmula é uma só. Tactic Bass: **Abstract Common Services** + **Increase Semantic Coherence**.

- **Resultado Esperado**
  > 3 call-sites → 1 fórmula única, testada em isolamento; qualquer mudança na tolerância de centavos, na fonte preferida ou na ordem de fallback toca **1 arquivo**. O `probe-invoice-pago` passa a validar o resolver diretamente (não a fórmula duplicada dentro do service).

- **Tactic alvo**: Abstract Common Services · Increase Semantic Coherence
- **Severidade**: P1
- **Esforço estimado**: M (2–4d — inclui teste unitário do resolver + migração dos 3 sites + ajuste do validador)
- **Findings relacionados**: F-modifiability-1, F-modifiability-4, F-modifiability-6
- **Métricas de sucesso**:
  - Call-sites que decidem "invoice pago": **3 → 1** (resolver) + N consumidores
  - Fontes de dado distintas: **3 → 2** (detalhe preferido, títulos como fallback; list nunca)
  - Políticas de fallback documentadas em 1 lugar: **3 → 1**
  - Reincidência esperada da classe de defeito nos próximos 6 meses: **0** (padrão-porto: qualquer nova ADR consulta o resolver)
- **Risco de não fazer**: 4ª reincidência garantida na próxima feature que consumir `DocFinanceiroAPagar.pago` ou `Invoice.pago` de um novo painel/relatório; retrabalho contínuo do time em bugs da mesma classe.
- **Dependências**: nenhuma; pode ser feito imediatamente após este delta.

### [modifiability-2] Neutralizar a armadilha do `ConexosBaseClient.isPago()` sobre `com298/list`

- **Problema**
  > `ConexosBaseClient.isPago(row)` (`ConexosBaseClient.ts:368-372`) continua público e ainda é chamado por `ConexosFinanceiroClient.ts:441,582` (`listFinanceiroAPagarByGerNum` e `mapDocPagar`) — os dois consumidores populam `DocFinanceiroAPagar.pago` com o boolean vindo do `com298/list`, que a sonda `probe-invoice-pago` (2026-08-28, PRD filial 2) provou ser inservível: `mnyTitAberto` volta `null` em 1146/1146 INVOICEs, então `isPago(row) === false` sempre. O nome do método promete o que a fonte não pode entregar — é uma armadilha ativa para qualquer feature que consumir `DocFinanceiroAPagar.pago` sem ler o comentário-armadilha em `EleicaoPermutasService.ts:594-598`.

- **Melhoria Proposta**
  > Duas opções (escolher com Yuri):
  > (a) **Renomear + restringir** — `isPago(row)` vira `isPagoFromDetailRow(row)`, com JSDoc explícito de que **não** deve ser chamado sobre `com298/list`. `ConexosFinanceiroClient.mapDocPagar` para de setar `pago` (deixa `undefined`) e força o caller a resolver via `invoicePagoResolver` (card 1).
  > (b) **Deprecar** — marcar `isPago` com `@deprecated`, remover dos 2 call-sites, e `DocFinanceiroAPagar.pago` vira `pago?: boolean` (opcional), sinalizando ao caller que precisa hidratar. Tactic Bass: **Encapsulate** + **Restrict Dependencies**.

- **Resultado Esperado**
  > Nenhum caller da camada financial-client obtém um boolean `pago` sobre a row do list que o próprio dev de client sabe ser mentira. O tipo passa a ser honesto (`pago?: boolean` + `undefined` quando não hidratado). O IDE e o `noUncheckedIndexedAccess` do TS forçam o consumidor a resolver.

- **Tactic alvo**: Encapsulate · Restrict Dependencies
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — 2 call-sites + ajuste de tipo + 1 lint sweep)
- **Findings relacionados**: F-modifiability-2, F-modifiability-1
- **Métricas de sucesso**:
  - Call-sites de `isPago(rowCom298List)`: **2 → 0**
  - `DocFinanceiroAPagar.pago` explicitamente opcional: **não → sim**
  - Comentários-armadilha ("`raw.pago` vem do `com298/list` — sempre `false`, fica só como piso") em production code: **1 → 0**
- **Risco de não fazer**: próxima feature de painel/relatório vai crer no boolean e reintroduzir o incidente da aba "em aberto".
- **Dependências**: idealmente após [modifiability-1] (o resolver dá o path oficial de hidratação).

### [modifiability-3] Extrair `derivarPagoDosTitulos` e outras funções puras para módulo próprio

- **Problema**
  > `derivarPagoDosTitulos` (`EleicaoPermutasService.ts:103-114`) é uma função pura exportada do TOPO do arquivo do serviço orquestrador só porque o validador (`jobs/validate-invoice-pago-detalhe-v1.ts:7`) precisou importá-la. O reflexo (não reimplementar a regra no validador) é correto; a **localização** é errada — o próximo consumidor da fórmula vai importar do `EleicaoPermutasService.ts`, arrastando dependência transitiva de `tsyringe` e de vários clients para quem só queria a regra. O mesmo se aplica a `somaValorNegociado` (linha 51).

- **Melhoria Proposta**
  > Criar `src/backend/domain/service/permutas/pagoInvoice.ts` (ou já `invoicePagoResolver.ts` do card 1) com as funções puras (`derivarPagoDosTitulos`, `somaValorNegociado`, `siglaMoedaNegociada`) e seus **próprios testes unitários** — hoje `derivarPagoDosTitulos` só é exercitada indiretamente via `hidratarInvoiceNegociada`. `EleicaoPermutasService` passa a `import`-ar, sem re-exportar. Tactic Bass: **Split Module**.

- **Resultado Esperado**
  > Zero named-exports em `EleicaoPermutasService.ts` (só o `export default`). Consumidores out-of-band (validadores, jobs, futuros relatórios) importam do módulo puro. Testes unitários da fórmula ficam próximos da fórmula.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — mover 3 funções, atualizar 2-3 imports, escrever testes unitários)
- **Findings relacionados**: F-modifiability-4, F-modifiability-3
- **Métricas de sucesso**:
  - Named-exports em `EleicaoPermutasService.ts`: **1 → 0**
  - Testes unitários próprios de `derivarPagoDosTitulos`: **0 → ≥ 4** (empty, missing fields, exact, resíduo-1-centavo)
  - LOC do `EleicaoPermutasService.ts`: **950 → ≤ 920** (pequeno mas conta)
- **Risco de não fazer**: qualquer nova ADR que precisar da fórmula pura vai importar do service e cimentar o god-object; complexidade cognitiva 65 do `buildCandidata` continua sendo o preço a pagar por qualquer refactor.
- **Dependências**: casa naturalmente com [modifiability-1] (o resolver ABSORVE essas funções).

### [modifiability-4] Externalizar tolerância de resíduo de reconciliação (invoice pago) para configuração

- **Problema**
  > A tolerância `face − pago === 0` (estrita) está cravada como magic-0 em `EleicaoPermutasService.ts:113` — decisão de NEGÓCIO explicitada em 2026-06-18 (`residual-pago-centavos`), mas materializada como constante inline. Mudar para "aceitar até R$0,02 de resíduo" exige recompilar + redeployar + replicar a nova regra nos sites A/B se eles vierem a usar a mesma fonte. É Defer-Binding zero para uma regra que já foi debatida.

- **Melhoria Proposta**
  > Extrair `TOLERANCIA_RESIDUO_PAGO_BRL` para `EnvironmentProvider` (default `0`, override por env `PERMUTAS_TOLERANCIA_PAGO_BRL`). A função pura passa a receber `(titulos, { tolerancia })` — sem singleton escondido. Documentar no `ontology/business-rules/invoice-pago-derivation.md` (card 5) que a tolerância é config, não código. Tactic Bass: **Defer Binding**.

- **Resultado Esperado**
  > Rotação da regra passa de "PR + code review + redeploy" para "atualizar env no Render + restart". Testabilidade da regra melhora (fica trivial passar `tolerancia=0.02` no teste).

- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 1 env var + 1 injeção + 1 teste)
- **Findings relacionados**: F-modifiability-5
- **Métricas de sucesso**:
  - Magic constants em regras de negócio de permutas: **≥ 1 → 0** (para esta regra)
  - Env vars com override documentado para regras contábeis: **+1**
- **Risco de não fazer**: quando o financeiro pedir a mudança (histórico mostra que ela já foi cogitada), vira feature-tweak completo em vez de flip de config.
- **Dependências**: idealmente após [modifiability-1] (a tolerância vive dentro do resolver).

### [modifiability-5] Registrar `invoice-pago-derivation` como business-rule canônica na ontologia

- **Problema**
  > A entidade `invoice` (`ontology/entities/invoice.md`) declara `pago` como propriedade, mas não há `business-rule` canônica em `ontology/business-rules/` que estabeleça a única fórmula, a fonte preferida e a política de fallback. `ontology/integrations/conexos.md` narra o problema (foi atualizado neste delta, +22 linhas) mas descrição narrativa não é invariante — o OntologyCurator não bloqueia uma futura feature de propor um 4º site com uma 4ª fórmula.

- **Melhoria Proposta**
  > Criar `ontology/business-rules/invoice-pago-derivation.md` referenciando (a) o resolver único (`src/backend/domain/service/permutas/invoicePagoResolver.ts` do card 1), (b) a decisão `residual-pago-centavos` (2026-06-18), (c) a validação `probe-invoice-pago` (2026-08-28, 30/30 concordância PRD). Bump `business_rules_total` no `_coverage.json` (19 → 20). O `OntologyCurator` passa a exigir que qualquer diff em `entities/invoice.md` ou `entities/adiantamento.md` mencione essa regra. Tactic Bass: **Restrict Dependencies** (via governance).

- **Resultado Esperado**
  > Próximo `/feature-new` que tocar a regra encontra a invariante no ontology-index e é obrigado a passar pelo resolver.

- **Tactic alvo**: Restrict Dependencies (governance)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — 1 arquivo markdown + bump de counters)
- **Findings relacionados**: F-modifiability-6, F-modifiability-1
- **Métricas de sucesso**:
  - `ontology/business-rules/invoice-pago-derivation.md` presente: **não → sim**
  - `business_rules_total`: **19 → 20**
  - `_index.json` mapeia a regra → módulo canônico: **não → sim**
- **Risco de não fazer**: rede de segurança do pipe (OntologyCurator + PatternGuardian) permanece cega para esta classe de defeito; a reincidência a-cada-3-meses continua.
- **Dependências**: idealmente após [modifiability-1] (a regra referencia o resolver).

## 6. Notas do agente

- Delta **não piorou** cognitive complexity (medido: 65+16 antes, 65+16 depois — o pure-function extraction pagou seu preço), mas herdou uma seam ainda maior (`EleicaoPermutasService` +41 LOC). Delta é **corretamente escopado** para o bug — a crítica de modifiability é sobre o débito estrutural que este delta **exercita mas não resolve**.
- Cross-QA links para o consolidator:
  - **[modifiability-2] `isPago()` armadilha** ↔ **Integrability**: o tipo `DocFinanceiroAPagar.pago` mente sobre o contrato do `com298/list`; Encapsulate parcial afeta os dois QAs.
  - **[modifiability-3] `derivarPagoDosTitulos` sem teste próprio** ↔ **Testability**: função crítica testada só de forma indireta via orquestrador; extrair o módulo destrava teste unitário de baixo custo (F-testability provável).
  - **[modifiability-4] magic-constant `=== 0`** ↔ **Deployability**: mudar tolerância = redeploy hoje; externalizar = flip de env no Render.
  - **F-modifiability-3 (god-object 950 LOC / cog-cx 65)** ↔ **Testability** (setup pesado para testar `buildCandidata`) e **Availability** (bug em `buildCandidata` derruba a run de eleição inteira; correção é lenta por causa da complexidade).
- Métricas não colhidas: circular deps (`madge` não instalado); dependency-cruiser não configurado. Fan-in medido por grep de `from '.*<name>'` — subestima em N caminhos (aliases/re-exports); resultados são piso.
