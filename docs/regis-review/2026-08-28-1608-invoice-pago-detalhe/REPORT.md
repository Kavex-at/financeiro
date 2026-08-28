---
type: regis-review-report
run_id: 2026-08-28-1608-invoice-pago-detalhe
generated_at: 2026-08-28T17:10:00-03:00
audience: technical (arquitetos, senior devs, tech lead)
basis: Bass & Clements — Software Architecture in Practice (Availability, Deployability, Integrability, Modifiability, Performance, Fault Tolerance, Security, Testability)
scope: DELTA da branch fix/invoice-pago-detalhe (commit 48abd7b vs origin/main 617ca3b)
total_cards: 33
total_p0: 3
total_p1: 9
total_p2: 14
total_p3: 7
overall_score: 6.2
---

# Regis-Review — financeiro — 2026-08-28-1608-invoice-pago-detalhe

> **STATUS PÓS-REMEDIAÇÃO (commit `15a1351`, adicionado pela orquestração após a consolidação):**
> 2 dos 3 P0 já foram remediados neste mesmo worktree, antes deste relatório ser materializado:
> `permuta-persistence-1` (ordem de precedência em `toInvoiceRows` + 2 testes de regressão, o
> primeiro deles provado falhando sem o fix) e `deployability-1` (bloco `type: cron` do
> `render.yaml` revertido — o arquivo voltou a ser idêntico a `origin/main`). Também entrou
> `fault-tolerance-1` na parte que era do delta (o `catch` da hidratação deixou de ser silencioso).
> **P0 remanescente: `testability-1`** (fixtures reais do wire de Permutas).
> Gates após a remediação: typecheck OK · lint 0 erros · 1486 testes (109 suites) · ground-truth 80/80.

> Delta minúsculo (11 arquivos, +756/-2) que corrige um bug real e visível (aba "Invoices em aberto" mostrando ~75% de invoices já liquidadas — 1146/1146 INVOICEs finalizadas da filial 2 com `mnyTitAberto: null` no `com298/list`). A correção — derivar `pago` de `titMnyTotPago` (com308) via `derivarPagoDosTitulos` — é tecnicamente correta, custa zero chamadas de rede novas e restaura a seletividade do índice parcial `idx_permuta_invoice_fil_aberto` (~1146 → ~287 linhas). **Mas dois defeitos estruturais impedem que o fix chegue ao usuário na prática**, e um deles não foi detectado por nenhum dos 8 agentes especialistas isolados — só emergiu na consolidação. Este relatório separa `o que este PR resolve` de `o que ele expõe`, e marca explicitamente o que bloqueia este PR de mergear (P0) vs. o que vira follow-up.

## 1. Executive scorecard

Pesos aplicados (multi-tenant SaaSo financeiro que executa escritas movendo dinheiro): Security 1.5 · Fault Tolerance 1.3 · Availability 1.2 · Modifiability 1.2 · Testability 1.0 · Performance 1.0 · Integrability 0.9 · Deployability 0.9 (Σ=9.0).

| QA | Score (0–10) | P0 | P1 | P2 | P3 | Top finding |
|---|---|---|---|---|---|---|
| Availability | 6.0 | 0 | 1 | 1 | 1 | F-availability-3: sem health check de frescor da ingestão (nem no backend nem badge na UI) |
| Deployability | 4.0 | 1 | 1 | 0 | 1 | F-deployability-1: cron do Render **duplica** o cron do GitHub Actions (`0 9,15,21 * * *` UTC) já em produção há semanas |
| Integrability | 6.0 | 0 | 2 | 2 | 2 | F-integrability-1: `com308RowSchema` foi ampliado neste PR mas continua **decorativo** — 0 usos no mapper de `listTitulosAPagar` |
| Modifiability | 5.5 | 1 | 2 | 2 | 1 | F-modifiability-1: 3 call-sites decidindo "invoice pago" com 3 fontes e 3 fallbacks distintos — 3ª reincidência da mesma classe em 10 semanas |
| Performance | 7.0 | 0 | 1 | 2 | 1 | F-performance-1: cron completa ~3.438 chamadas Conexos capadas por 3 sessões ERP, wall-time estimado 11–13 min, sem instrumentação |
| Fault Tolerance | 7.0 | 0 | 2 | 2 | 0 | F-fault-tolerance-1: `catch {}` silencioso na hidratação do `pago` — degradação parcial invisível pós-fato |
| Security | 7.0 | 0 | 1 | 2 | 1 | F-security-5: `com308RowSchema.titMnyTotPago` decorativo — valores anômalos do wire influenciam decisão financeira sem validação |
| Testability | 6.0 | 1 | 1 | 3 | 0 | F-testability-1: 62 dias entre introdução do padrão inseguro (2026-06-24) e detecção pela Simone (2026-08-25) — mocks hand-typed em vez de fixtures reais |
| **Overall** | **6.2** | **3** | **9** | **14** | **7** | — |

**Score interpretation** — 0–3 risco estrutural / 4–6 dívida defensável / 7–8 saudável com oportunidades / 9–10 estado-da-arte para o estágio atual.

Deployability=4 é o outlier estrutural: o delta introduziu um segundo agendador para o mesmo job que já rodava no GitHub Actions (`Cron GRATUITO via GitHub Actions (Render Cron Job é pago)` — comentário do próprio workflow, verificado em `origin/main`). Isto é reversível com um único commit e é o card de maior prioridade defensável em reunião.

## 2. Top 10 risks (cross-QA)

Ranking por composto **severidade × blast radius × custo de inação**. Cada risco marca explicitamente **[Introduzido pelo delta]**, **[Exposto pelo delta]** ou **[Pré-existente que este delta não tocou]**.

### R-1: A correção NÃO alcança invoices cujo processo tem adiantamento — o `pago` derivado do com308 é sobrescrito pela row do `com298/list` (sempre `false`)

- **QA(s) afetados**: Modifiability, Integrability, Testability, Fault Tolerance (cross-cutting)
- **Findings de origem**: **Novo P0** identificado apenas na consolidação (nenhum agente isolado pegou). Relaciona-se com F-modifiability-1, F-modifiability-2, F-integrability-4, F-testability-1.
- **Evidência sintetizada**: `IngestaoPermutasService.toInvoiceRows` monta `permuta_invoice` em duas passadas: (linha 323) primeiro as invoices das candidatas; (linha 337) depois o universo hidratado com `if (byDocCod.has(inv.docCod)) continue`. **A entrada da candidata sempre vence.** As invoices das candidatas vêm de `listFinanceiroAPagar` → `mapDocPagar` → `ConexosBaseClient.isPago(row)` (`ConexosFinanceiroClient.ts:582`) — a MESMA fonte sempre-`false` do `com298/list` que este delta veio corrigir. O validador `validate-invoice-pago-detalhe-v1.ts` passou 80/80 porque exercita `derivarPagoDosTitulos` DIRETAMENTE contra o com308, **sem passar pelo caminho de persistência**.
- **Impacto técnico**: para toda INVOICE cujo processo tenha um adiantamento (justamente as mais relevantes para permuta — o universo alvo do produto), `permuta_invoice.pago = false` persiste após a ingestão mesmo com o com308 dizendo o contrário. O sintoma da Simone permanece para essas invoices.
- **Impacto de negócio**: bug corrigido no papel, não no banco. A demonstração da correção (aba limpa) só vale para invoices sem adiantamento no processo — o pior recorte possível para permutas. Confiança na aba não é restaurada; retrabalho manual continua.
- **Card(s) Kanban relacionados**: `permuta-persistence-1` (P0, novo), `modifiability-1`, `modifiability-2`
- **Custo de inação em 6 meses**: o delta é declarado como fix e mergeia; próxima reclamação da Simone reabre o incidente, mas agora com narrativa "já foi corrigido antes" — perda de credibilidade + custo dobrado de investigação (o defeito real está uma camada abaixo do que o PR mostra).
- **Origem**: **[Exposto pelo delta]** — pré-existente, mas revelado pela tentativa de correção.

### R-2: Dois crons agendam `ingest-permutas` na mesma janela — o cron do Render (novo neste delta) duplica o do GitHub Actions já em PRD

- **QA(s) afetados**: Deployability, Availability, Fault Tolerance, Security (envelope de segredos)
- **Findings de origem**: F-deployability-1 (P0), F-deployability-2/3/5, F-security-1, F-availability-1/5
- **Evidência sintetizada**: `.github/workflows/ingest-permutas.yml` em `origin/main` já roda `cron: '0 9,15,21 * * *'` UTC (3×/dia, 06:00/12:00/18:00 BRT) desde antes deste delta, com execuções `success` diárias (última verificada 2026-08-28T05:03Z, 1m32s). O cabeçalho do workflow diz textualmente `Cron GRATUITO via GitHub Actions (Render Cron Job é pago)`. O delta acrescenta `render.yaml:100-134` com `schedule: '0 9 * * *'` UTC — colisão exata com o tick das 06:00 BRT. O advisory-lock protege a integridade dos dados; o perdedor faz `exit 1` e polui logs.
- **Impacto técnico**: falso-positivo diário no dashboard do Render (execução `failed` benigna); custo do plano Render cron pago sem benefício; drift-risk em 10 chaves de env replicadas em dois blocos; superfície de segredos dobrada; envs de escrita (`CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`) num job read-only.
- **Impacto de negócio**: custo mensal Render sem contrapartida; ruído em logs que camufla erros reais; futura rotação de `CONEXOS_PASSWORD` esquece um dos blocos e a ingestão para silenciosamente (mesmo padrão do bug corrigido, causa nova).
- **Card(s) Kanban relacionados**: `deployability-1` (P0)
- **Custo de inação em 6 meses**: um único operador rota credencial no dashboard do Render, esquece do bloco cron, ingestão para; a tela mostra dados antigos por dias até alguém abrir chamado. Recorrência estimada com base em runbook manual não versionado: 1× por semestre.
- **Origem**: **[Introduzido pelo delta]** — reversível em um commit.

### R-3: Reincidência-por-classe da regra "está pago?" — 3 call-sites, 3 fontes, 3 fallbacks, 3 correções em 10 semanas

- **QA(s) afetados**: Modifiability, Integrability, Testability, Fault Tolerance
- **Findings de origem**: F-modifiability-1 (P1), F-modifiability-2 (P1), F-integrability-4 (P2), F-testability-1 (P0)
- **Evidência sintetizada**: cronologia comprovada por `git log`: 01b99bf 2026-06-18 (Gate 3 do ADIANTAMENTO — `getDetalheTitulos().pago`) → df90fa6 2026-06-21 (invoice na ALOCAÇÃO — `getDetalheTitulos().pago`) → 48abd7b 2026-08-28 (invoice na INGESTÃO — `derivarPagoDosTitulos(listTitulosAPagar)`). **Cada correção pontual num site; cada site novo herda o bug.** `ConexosBaseClient.isPago(row)` continua público e é chamado em `ConexosFinanceiroClient.ts:441,582` sobre a MESMA row inservível. É a armadilha por trás do R-1.
- **Impacto técnico**: cognitive complexity de `EleicaoPermutasService.buildCandidata` = 65 (Biome teto 15); 950 LOC; 16 métodos; qualquer nova ADR que precisar da regra em 4º site herda o padrão-armadilha.
- **Impacto de negócio**: bug-a-cada-3-meses. Sem consolidação, R-1 tende a reincidir a cada nova aba/relatório/exportação que consumir `Invoice.pago` ou `Adiantamento.pago`.
- **Card(s) Kanban relacionados**: `modifiability-1` (resolver único), `modifiability-2` (deprecar `isPago`), `testability-1` (fixtures), `modifiability-3`/`modifiability-4`/`modifiability-5`
- **Custo de inação em 6 meses**: 4ª reincidência garantida na próxima feature que consumir `DocFinanceiroAPagar.pago`. Cada incidente custa ~3-5 dias de investigação + follow-up.
- **Origem**: **[Pré-existente]** — este delta é a 3ª manifestação; a 4ª está agendada se a arquitetura não mudar.

### R-4: Mocks hand-typed permitem que a mesma classe de defeito passe 62 dias sem detecção — não há fixture real do wire de Permutas no repo

- **QA(s) afetados**: Testability, Integrability, Fault Tolerance
- **Findings de origem**: F-testability-1 (P0), F-testability-6 (P2), F-integrability-3 (P2)
- **Evidência sintetizada**: 269 `mockResolvedValue`/`mockReturnValue`/`mockRejectedValue` em 11 arquivos de `domain/service/permutas/*.test.ts`; 0 fixtures capturadas em `domain/interface/permutas/__fixtures__/` (vs. 16 no SISPAG + `contrato.test.ts`). O padrão existe e é documentado no repo (`jobs/capture-fixtures-sispag.ts`, 255 LOC) — mas foi omitido para Permutas. O bug do `pago` do wire (comitado em 634eef0 em 2026-06-24) sobreviveu 62 dias porque os mocks otimistas hidratavam INVOICE com campos preenchidos, enquanto o wire real devolve `mnyTitAberto: null` em 100% dos casos.
- **Impacto técnico**: cada probe descoberta (`probe-invoice-pago.ts` neste delta) e cada validador ao vivo (`validate-invoice-pago-detalhe-v1.ts`) prova algo sobre um dia; a evidência não sobrevive ao próximo commit porque não vira fixture. MTTD de mudança de contrato ERP: >30d.
- **Impacto de negócio**: R-3 se materializa porque R-4 permite. Sem fixtures, cada nova ADR de Permutas nasce com a mesma dívida de detecção. Detecção depende de relato de campo (padrão histórico).
- **Card(s) Kanban relacionados**: `testability-1` (P0), `testability-6`, `integrability-3`, `testability-3`
- **Custo de inação em 6 meses**: 2-3 novos defeitos de contrato descobertos por relato de usuário; MTTD por defeito ~30d.
- **Origem**: **[Pré-existente]** — este delta prova a dor mas não sana a raiz.

### R-5: `com308RowSchema` decorativo — Zod ampliado no delta mas 0 usos em produção

- **QA(s) afetados**: Integrability, Security, Fault Tolerance
- **Findings de origem**: F-integrability-1 (P1), F-security-5 (P1) — deduplicados no consolidado
- **Evidência sintetizada**: `grep -c "safeParse|\.parse(" src/backend/domain/client/ConexosTitulosClient.ts` = 0. O irmão `ConexosSispagClient` valida rows do `fin064` (9 usos de `.parse`). 10 de 12 clients Conexos usam Zod no boundary. `com308RowSchema` foi ampliado com `titMnyTotPago: wireNumber.optional()` neste delta — e continua ignorado.
- **Impacto técnico**: se o Conexos passar a devolver `titMnyTotPago` como `"1,23"` (locale-BR), objeto envelope (`{value: 123}`), sentinel negativo, ou o campo sumir silenciosamente, o mapper devolve `undefined`/valor absurdo e a derivação vira "não sei" ou "sei errado" → mesmo modo de falha que este PR corrige, agora com casca nova.
- **Impacto de negócio**: reintrodução da classe do bug sem sinal de alarme; detecção depende de relato humano.
- **Card(s) Kanban relacionados**: `integrability-1` (P1, dedupe com `security-2`)
- **Custo de inação em 6 meses**: probabilidade média-alta de drift de wire em algum campo Conexos por semestre; custo de detecção ~2 semanas por incidente.
- **Origem**: **[Introduzido pelo delta]** — o schema foi ampliado, o wire-up ficou faltando.

### R-6: `fieldList` explícito com 7 campos amplia blast radius; uma quebra no `com308` derruba 4 features de uma vez

- **QA(s) afetados**: Integrability, Fault Tolerance, Availability
- **Findings de origem**: F-integrability-2 (P1)
- **Evidência sintetizada**: `ConexosTitulosClient.ts:245-256` declara `fieldList: ['titCod','titFltTaxaMneg','titMnyValorMneg','titMnyValor','titMnyTotPago','moeCodMneg','moeEspNome']`. `ConexosFinanceiroClient.ts:398-415` faz o OPOSTO (`fieldList: []`) com comentário explicando `com298/list` rejeita várias colunas via Oracle `ORA-00904 invalid identifier` quando explicitamente listadas — histórico documentado com `mnyTitAberto`/`mnyTitPermutar`/`moeEspSigla` no repo. Se `titMnyTotPago` cair na mesma armadilha, o `POST` volta 400/500 e mata `pago` + taxa + `valorNegociado` em 4 consumidores independentes (`EleicaoPermutasService` × 3 caminhos + `AlocacaoPermutasService` + `ReconciliacaoPermutaService`).
- **Impacto técnico**: 4 features degradam simultaneamente numa única falha de wire; todos os call-sites têm `try/catch{}` silencioso — a falha vira degradação invisível.
- **Impacto de negócio**: aba de Permutas com dados incompletos + Alocação sem valorNegociado + Reconciliação de baixa quebrada, tudo ao mesmo tempo, sem alarme.
- **Card(s) Kanban relacionados**: `integrability-2` (P1), `integrability-1`
- **Custo de inação em 6 meses**: probabilidade média (o Conexos tem histórico de breaking changes silenciosos em `fieldList`); impacto alto.
- **Origem**: **[Introduzido pelo delta]** — antes deste PR, o `fieldList` do `com308` era menor.

### R-7: `catch {}` silencioso em 4 call-sites do fan-out com308 apaga a taxa real de fallback

- **QA(s) afetados**: Fault Tolerance, Availability, Integrability
- **Findings de origem**: F-fault-tolerance-1 (P1), F-availability-4 (P2), F-integrability-7 (P2) — deduplicados
- **Evidência sintetizada**: `grep -n "catch {" src/backend/domain/service/permutas/EleicaoPermutasService.ts` → linhas 563, 622, 858 + `AlocacaoPermutasService.ts:149`. Todos degradam intencionalmente (`pago=false` no piso conservador — direção correta), mas nenhum incrementa contador ou emite `logService.warn`. O padrão warn correto existe no MESMO arquivo em 6+ pontos (linhas 190, 303, 355, 429, 451, 699). Enum `IngestRunHeader.status = 'partial'` declarado no tipo, nunca emitido. Não há coluna `permuta_invoice.pago_source`. Um surto de erros no com308 (MAX_SESSIONS, 5xx) reproduz o sintoma original sem sinal.
- **Impacto técnico**: uma run com 30% de invoices no fallback é gravada como `status='success'`; auditoria mente sobre a saúde da run.
- **Impacto de negócio**: sintoma reaparece por causa nova (com308 degradado), diagnóstico só via inspeção manual de logs do Conexos.
- **Card(s) Kanban relacionados**: `fault-tolerance-1` (P1, consolida os três), `fault-tolerance-3` (P2, status partial)
- **Custo de inação em 6 meses**: alta probabilidade (o com308 é o endpoint mais exercitado); custo por incidente inversamente proporcional à observabilidade.
- **Origem**: **[Pré-existente]** — 3 dos 4 catches já existiam; o delta acrescentou o quarto (linha 622) mantendo o padrão.

### R-8: Cron dispara ~3.438 chamadas Conexos capadas por 3 sessões, wall-time estimado 11–13 min, sem instrumentação

- **QA(s) afetados**: Performance, Availability, Fault Tolerance
- **Findings de origem**: F-performance-1 (P1), F-performance-5 (P2), F-performance-4 (P2)
- **Evidência sintetizada**: `FILIAIS_CONCURRENCY=5 × ADIANTAMENTOS_CONCURRENCY=10 = 50` workers concorrentes teóricos vs. `LOGIN_ERROR_MAX_SESSIONS ≈ 3` (pool efetivo do usuário Conexos). Filial 2 mede 1.146 INVOICEs finalizadas na sonda; 3 filiais → ~3.438 chamadas com308 apenas para o universo + M adiantamentos + variação cambial. Estimativa 11–13 min/run — sem contador de requests, sem timeout global no job, sem alerta de wall-time.
- **Impacto técnico**: run que estoure 2h (a janela pré-comercial é ~2h: 06:00 → 08:00 BRT) invade o tráfego do analista e produz `LOGIN_ERROR_MAX_SESSIONS` em `/permutas/gestao` + Frente III + Frente IV que competem pelos mesmos slots.
- **Impacto de negócio**: analista abre a aba antes do dado do dia estar pronto → decisão com número velho → retrabalho.
- **Card(s) Kanban relacionados**: `performance-1` (P1), `performance-4` (P2)
- **Custo de inação em 6 meses**: probabilidade média (dependente do crescimento de invoices por filial); descoberta depende de ticket do analista.
- **Origem**: **[Pré-existente]** — o fan-out já existia; o cron novo só o executa 3×/dia (o do GitHub) sem alterar o fan-out.

### R-9: Ausência de health check de frescor + kill-switch runtime + Self-Test do com308

- **QA(s) afetados**: Availability, Deployability, Fault Tolerance
- **Findings de origem**: F-availability-3 (P2), F-availability-5 (P3 — parcialmente resolvido pela reversão do cron do Render), F-deployability-4 (P1)
- **Evidência sintetizada**: `PermutaSnapshotRepository.findLatestIngestFinishedAt()` já existe e é lido em `GestaoPermutasService.ts:61` — falta o comparador `age > threshold`. UI (`page.tsx:648-655`) mostra a data mas não sinaliza degradação. `render.yaml` **não** tem `PERMUTAS_INGEST_ENABLED` — contraste com `SISPAG_LIVE_WRITE_ENABLED` (`render.yaml:35`) e `RECEBIMENTOS_ENABLED` (`render.yaml:45`). Após a reversão do cron do Render (R-2), o kill-switch cabível é sobre o workflow do GitHub Actions (via env checada pelo job).
- **Impacto técnico**: sem sinal visual, a analista aceita silenciosamente o carimbo desatualizado — condição que produz o sintoma "invoice liquidada aparece" (o dado é retrato do momento da ingestão).
- **Impacto de negócio**: mesmo padrão do R-1: correção estruturalmente boa evapora quando a ingestão para sem alarme.
- **Card(s) Kanban relacionados**: `availability-1` (P1, reformulado — badge UI + endpoint health), `deployability-4` (P2, reformulado como env do job)
- **Custo de inação em 6 meses**: baixa-média probabilidade (o cron do GitHub tem histórico de 100% success); impacto por incidente alto (o próprio bug corrigido tem essa forma).
- **Origem**: **[Pré-existente + parcialmente introduzido pelo delta]** — a UI badge e o endpoint sempre faltaram; a proposta original de kill-switch era para o cron do Render (agora reversível).

### R-10: Validadores ao vivo apodrecem — 8 `validate-*.ts` no repo, 0 executados em CI, 0 registro de última execução

- **QA(s) afetados**: Testability, Integrability, Fault Tolerance
- **Findings de origem**: F-testability-3 (P1), F-integrability-3 (P2), F-fault-tolerance-4 (P2 — validate weekly)
- **Evidência sintetizada**: `ls src/backend/jobs/validate-*.ts | wc -l` = 8. `grep "validate:" src/backend/package.json` vazio. `grep -rn "validate-" .github/workflows/` vazio. O ground-truth "80/80 concordam" do `validate-invoice-pago-detalhe-v1` foi medido no dia 2026-08-28 pelo assistente durante a sessão do `/feature-tweak` (correção C4: F-integrability-3 atribuía ao Yuri) e não tem cadência.
- **Impacto técnico**: certificações "N/N concordam" valem para o dia; se `derivarPagoDosTitulos` for renomeada ou `getDetalheTitulos` retirado, os validadores só quebram no próximo run manual.
- **Impacto de negócio**: janela entre "regra quebrou" e "alguém percebe" é a mesma dos incidentes anteriores (histórico: 2 meses).
- **Card(s) Kanban relacionados**: `testability-3` (P1, promover a `.integration.test.ts`), `fault-tolerance-4` (P2, cron semanal do validator)
- **Custo de inação em 6 meses**: alta probabilidade de que ≥1 validador esteja quebrado sem ninguém saber ao final do trimestre.
- **Origem**: **[Pré-existente]** — o padrão nasceu antes; o delta acrescentou o 8º sem mudar a política.

## 3. Cross-cutting findings

Pontos onde a mesma causa-raiz aparece em múltiplos QAs. Cada CC-N mapeia para 1-2 cards que resolvem o conjunto.

### CC-1: `catch {}` silencioso no fan-out com308 apaga a taxa real de fallback

- **Aparece em**: Availability (F-availability-4), Fault Tolerance (F-fault-tolerance-1), Integrability (F-integrability-7)
- **Diagnóstico unificado**: 4 call-sites (`EleicaoPermutasService.ts:563,622,858` + `AlocacaoPermutasService.ts:149`) engolem a exceção do com308 sem log/contador; a degradação (`pago=false` no piso) é intencional e correta, mas apaga o SINAL. Ao mesmo tempo, `IngestRunHeader.status='partial'` está declarado no tipo (`PermutaRelationalRepository.ts:92`) e nunca é emitido — auditoria mente. E `permuta_invoice.pago` é um booleano sem qualificador de fonte.
- **Recomendação consolidada**: card `fault-tolerance-1` (P1) é o consolidado — substitui os 3-4 catches por `logService.warn` + contador `fallbackCount` propagado ao `FLOW_COMPLETE` + coluna `permuta_invoice.pago_source text CHECK (pago_source IN ('titulo','fallback'))` + emissão de `status='partial'` (subcard `fault-tolerance-3`).

### CC-2: `com308RowSchema` decorativo — validação de wire ausente

- **Aparece em**: Integrability (F-integrability-1), Security (F-security-5)
- **Diagnóstico unificado**: schema Zod ampliado neste delta (+`titMnyTotPago`) mas nunca invocado. Ao mesmo tempo, o irmão `ConexosSispagClient` valida rows do `fin064` (9 `.parse`) e 10 de 12 clients Conexos usam Zod. Assimetria óbvia — herda o padrão-armadilha.
- **Recomendação consolidada**: card `integrability-1` (P1) — aplicar `com308RowSchema.safeParse(r)` no mapper de `listTitulosAPagar` + `wireNumber.refine(n => n >= 0)` para negar valores absurdos. Zero impacto no happy path; ganho: drift silencioso vira BUSINESS_WARN.

### CC-3: Regra "está pago?" reimplementada em 3+ sites com fontes/fallbacks distintos

- **Aparece em**: Modifiability (F-modifiability-1, F-modifiability-2), Integrability (F-integrability-4), Testability (F-testability-1), Fault Tolerance (F-fault-tolerance-1)
- **Diagnóstico unificado**: `EleicaoPermutasService.buildCandidata:665` (Gate 3 ADIANTAMENTO — `getDetalheTitulos().pago`) + `AlocacaoPermutasService:129-135` (invoice ALOCAÇÃO — `getDetalheTitulos().pago`) + `EleicaoPermutasService.hidratarInvoiceNegociada:606-623` (invoice INGESTÃO — `derivarPagoDosTitulos(com308)`) + trap ativa em `ConexosBaseClient.isPago()` sobre row do `com298/list` (sempre `false`). Além disso, a ORDEM em `IngestaoPermutasService.toInvoiceRows` faz a fonte-armadilha vencer a fonte-correta (R-1). Esta é a raiz da reincidência-por-classe.
- **Recomendação consolidada**: card `modifiability-1` (P1) — extrair `invoicePagoResolver` (função pura) com API `resolver({getDetalhe, listTitulos, rowList}) → { pago, fonte, razao }` e migrar os 3 call-sites. Casa com `modifiability-2` (deprecar `isPago(rowCom298List)`) e resolve estruturalmente R-1 quando combinado com o fix de ordem em `permuta-persistence-1` (P0).

### CC-4: Evidência de probe/validate ao vivo não vira artefato de teste persistente

- **Aparece em**: Testability (F-testability-1, F-testability-6), Integrability (F-integrability-3), Fault Tolerance (F-fault-tolerance-4)
- **Diagnóstico unificado**: o repo tem 24 probes + 8 validators versionados (excelente prática) mas 0 fixtures capturadas em `permutas/__fixtures__/` (SISPAG tem 16) e 0 validators executados em CI/schedule. Cada descoberta (`mnyTitAberto: null em 1146/1146`) foi transcrita à mão para mock — evidência não sobrevive ao próximo commit.
- **Recomendação consolidada**: cards `testability-1` (P0, fixtures + contract test) + `testability-3` (P1, promover validate-*.ts a `.integration.test.ts` opt-in) + `fault-tolerance-4` (P2, cron semanal do validator via GitHub Actions).

### CC-5: Superfície de segredos e envelope de privilégio ampliados pelo cron do Render

- **Aparece em**: Security (F-security-1), Deployability (F-deployability-3/4), Availability (F-availability-5)
- **Diagnóstico unificado**: o novo bloco `envVars` do cron duplica 10 chaves + envs de escrita (`CONEXOS_WRITE_ENABLED`, `CONEXOS_DRY_RUN`) num job read-only. Após a reversão (CC-6), este cross-cutting evapora.
- **Recomendação consolidada**: **RESOLVIDO PELA REVERSÃO** (card `deployability-1`). Único remanescente: `security-5` (P3, runbook de rotação de credenciais Conexos — permanece útil mesmo com 1 lugar de env, para forçar validação pós-rotação).

### CC-6: Cron do Render duplica o cron do GitHub Actions já em PRD

- **Aparece em**: Deployability (F-deployability-1/2/3/5), Availability (F-availability-1/5), Security (F-security-1)
- **Diagnóstico unificado**: `.github/workflows/ingest-permutas.yml` (em `origin/main`, `cron '0 9,15,21 * * *'` UTC, executando `success` diariamente) já cobre a cadência. O bloco `type: cron` novo do `render.yaml` reintroduz o custo evitado (`Cron GRATUITO via GitHub Actions (Render Cron Job é pago)`) e cria duas cadências concorrentes.
- **Recomendação consolidada**: card `deployability-1` (P0) — **reverter o bloco `type: cron` do `render.yaml`**. Um único commit resolve: F-deployability-1, F-deployability-2, F-deployability-3, F-deployability-5, F-security-1, F-availability-1 (parte cron), F-availability-5 (parte cron). Não resolve F-availability-3 (freshness UI) nem F-deployability-4 (kill-switch — passa a ser sobre o job invocado pelo GH cron).

## 4. Quick wins (≤5 dias úteis)

Cards com esforço S, severidade ≥ P2, alta razão impacto/esforço. Aceitáveis como primeira sprint pós-aprovação.

| Card | QA | Esforço | Severidade | Resultado esperado |
|---|---|---|---|---|
| `deployability-1` | Deployability | S | P0 | 0 execuções concorrentes; 0 `IngestLockBusyError` diário; custo Render cron → R$0; 10 chaves duplicadas → 0 |
| `permuta-persistence-1` | Modifiability + Fault Tolerance | S | P0 | Invoices com adiantamento no processo passam a persistir `pago` real; o fix chega ao banco |
| `integrability-1` | Integrability + Security | S | P1 | 100% das rows do com308 validadas por Zod; drift silencioso vira BUSINESS_WARN (unifica F-integrability-1 + F-security-5) |
| `fault-tolerance-2` | Fault Tolerance | S | P1 | Cron perdedor do lock não vira "failed"; alerta futuro nasce limpo |
| `availability-1` | Availability | S | P1 | Badge UI amarelo/vermelho quando `age(last_success_ingest) > 24h`; endpoint `/permutas/health` |
| `performance-1` | Performance | S | P1 | `flow_duration_ms` + `conexos_requests_total{endpoint}` no `FLOW_COMPLETE`; baseline após 3 execuções |
| `fault-tolerance-3` | Fault Tolerance | S | P2 | `status='partial'` emitido quando `fallbackCount > 0` (depende de `fault-tolerance-1`) |
| `fault-tolerance-4` | Fault Tolerance | S | P2 | Reconciliação semanal do validator via GH Actions — janela `drift → alarme` ≤ 7d |
| `testability-2` | Testability | S | P2 | Unit tests diretos de `derivarPagoDosTitulos`; ramo `titulos.length === 0` coberto |
| `testability-4` | Testability | S | P2 | `render.yaml` linted no CI (yamllint + assert de `startCommand` em `package.json`) |
| `integrability-4` | Integrability | S | P2 | Docstring em `fetchInvoicesBatched` e no par adto/inv explicando por que só `hidratarInvoiceNegociada` persiste `pago` |
| `security-3` | Security + Deployability | S | P2 | `dist/jobs/probe-*.js` e `dist/jobs/validate-*.js` → 0 arquivos; gate `PROBE_ALLOW_PRD` emite `LogService.warn` |
| `security-4` | Security | S | P2 | `/tmp/probe-invoice-pago/achados.json` com PII redigida e `unlink` no `finally` |
| `modifiability-2` | Modifiability | S | P1 | 0 call-sites de `isPago(rowCom298List)`; `DocFinanceiroAPagar.pago` opcional; armadilha desativada |
| `modifiability-3` | Modifiability + Testability | S | P2 | `derivarPagoDosTitulos` em módulo próprio; 0 named-exports em `EleicaoPermutasService.ts` |
| `modifiability-4` | Modifiability | S | P2 | Tolerância de resíduo virou env `PERMUTAS_TOLERANCIA_PAGO_BRL` |

## 5. Strategic moves (M / L / XL)

Cards de maior fôlego com justificativa numerada.

| Card | QA(s) | Esforço | Tactic alvo | Por que vale |
|---|---|---|---|---|
| `modifiability-1` | Modifiability + Integrability + Fault Tolerance | M | Abstract Common Services + Increase Semantic Coherence | Corta a reincidência-por-classe (3 correções em 10 semanas — R-3) na raiz. Sem ele, R-1 tem chance ≈ 100% de reincidir na 4ª feature |
| `testability-1` | Testability + Integrability | M | Record/Playback + Abstract Data Sources | Bug atual sobreviveu 62 dias porque não havia fixture real do wire. Contract test amarra 269 mocks hand-typed ao payload que o ERP realmente devolve. MTTD de mudança de contrato: 30d+ → ≤1d |
| `integrability-2` | Integrability + Fault Tolerance | M | Tailor Interface + Backward-compatibility shims | Corta o blast radius (R-6): quebra no `com308` deixa de derrubar 4 features simultâneas; sobra 1 (o próprio `pago`, degradado com fallback ao detail) |
| `integrability-3` | Integrability + Testability | M | Contract testing + Discover Service | Complementa `testability-3` com execução scheduled contra HML; janela de detecção de drift no wire: dias/semanas → ≤24h. Alto ROI dado que 24 probes já existem no repo |
| `testability-3` | Testability + Integrability | M | Sandbox + Recordable Test Cases | Promove 8 validadores ao vivo para `.integration.test.ts` opt-in; assinaturas ficam protegidas por typecheck do CI mesmo sem credencial PRD. Reverte R-10 |
| `performance-4` | Performance + Availability | M | Increase Concurrency (calibrada) + Schedule Resources | Alinha `FILIAIS_CONCURRENCY × ADIANTAMENTOS_CONCURRENCY` ao pool real de 3 sessões Conexos (50 workers teóricos → 3-6 efetivos); remove pressão de fila que compete com Frentes III/IV. Depende de `performance-1` para medir o ganho |
| `testability-5` | Testability + Modifiability | L | Limit Structural Complexity | Quebra `EleicaoPermutasService` (950 LOC / cognitive complexity 65 em `buildCandidata`) em subserviços coesos; TTR do próximo bug da frente cai proporcionalmente. Pré-requisito para tornar `modifiability-1` sustentável |
| `deployability-4` | Deployability + Availability | M | Rollback | Kill-switch runtime (`PERMUTAS_INGEST_ENABLED` lido pelo job antes de bootstrapar) para pausa em ≤60s sem editar workflow do GH; MTTR emergencial: 5min (edit + redeploy) → 1min (toggle no dashboard). Ganha valor após CC-6 resolvido |

## 6. O que está bem (e por quê)

Curto e obrigatório para calibrar a defesa. Cada ponto ancorado a tactic Bass + evidência.

1. **A decisão arquitetural do fix é correta** — em vez de dobrar o fan-out (`getDetalheTitulos` por invoice, ~3.400 → ~6.800 chamadas/run), o delta acrescenta 1 campo (`titMnyTotPago`) ao `fieldList` do com308 que já era chamado. Custo marginal: ~10 bytes/row. Tactic Bass: **Reduce Overhead**. Evidência: `ConexosTitulosClient.ts:250-253` + `EleicaoPermutasService.ts:616-621`.
2. **Direção do fallback consistente e documentada** — os 3 call-sites (`EleicaoPermutasService.ts:98-102, 623-626` + `AlocacaoPermutasService.ts:~130`) escolhem "mostrar > esconder" com docstring explicando `esconder tira dinheiro do radar da analista; mostrar apenas incomoda`. Tactic Bass: **Increase Competence Set** + **Sanity Checking**. Evidência: F-fault-tolerance-5 (finding positivo).
3. **`derivarPagoDosTitulos` como função pura exportada** — permite que o validador ao vivo importe a MESMA função da produção em vez de reimplementar a regra (`validate-invoice-pago-detalhe-v1.ts:7`). Tactic Bass: **Specialized Interfaces**. O comentário no validador é explícito: `um validador que reescreve a fórmula valida a si mesmo`.
4. **`sanity checking` explícito no `derivarPagoDosTitulos`** — retorna `undefined` (não `false`) quando `titulos.length === 0` ou algum título sem `valorBrl`/`valorPago`. Distinção `undefined` vs `0` mantida em toda a cadeia (`parseOptionalNumber` propaga `null/''` → `undefined`, `0` legítimo → `0`). Tactic Bass: **Exception Prevention**. Evidência: `EleicaoPermutasService.ts:104-113`.
5. **Restauração do índice parcial** — `idx_permuta_invoice_fil_aberto WHERE NOT pago AND NOT stale` era tautologicamente satisfeito (predicado `NOT pago` era no-op enquanto `pago` era sempre `false`) — passa a ser a estratégia de acesso real. Payload de `/permutas/gestao` cai ~75% (1.146 → ~287 linhas). Tactic Bass: **Index discipline** + **Reduce Overhead**. Evidência: F-performance-3.
6. **`pg_try_advisory_lock` + `withTransaction` serializam cron × trigger manual** — proteção contra escritas concorrentes via `INGEST_LOCK_KEY=918273645`; `IngestLockBusyError` tipado; qualquer falha reverte tudo, last-good sobrevive. Tactic Bass: **Transactions** + **Rollback**. Evidência: `IngestaoPermutasService.ts:53-72`, `PermutaRelationalRepository.ts:193-210`.
7. **Ground-truth validator no repo** — `validate-invoice-pago-detalhe-v1.ts` prova 80/80 concordância entre `derivarPagoDosTitulos(com308)` e `getDetalheTitulos().pago`. Tolerância = 0 divergências. Tactic Bass: **Comparison**. É base para `testability-3`.
8. **Gate `PROBE_ALLOW_PRD=1` presente** — sondas READ-ONLY em PRD recusam execução sem env explícita (`probe-invoice-pago.ts:60-66`, `validate-invoice-pago-detalhe-v1.ts:29-32`). Tactic Bass: **Limit Access** (parcial — a estruturação vai para `security-3`).

## 7. Limitações da análise

- **Métricas declaradas como não medíveis localmente**: MTTR real de "cron não rodou", p95 latência em PRD de `/permutas/gestao`, taxa real de fallback do com308, wall-time real do cron (o do GitHub Actions roda mas não expõe `flow_duration_ms`; o do Render é novo e não rodou em PRD), `LOGIN_ERROR_MAX_SESSIONS` por run. `performance-1` cria a instrumentação que torna essas métricas medíveis.
- **`npm audit`** não reexecutado nesta run (escopo `--quick`); assumido verde por herança do commit base `617ca3b` (que bumpou axios exatamente para destravar o CI). Recomendação: reexecutar antes do próximo `chore(release)`.
- **Cobertura por linha em `EleicaoPermutasService.ts`** contada por leitura de teste (5/6 ramos observáveis de `derivarPagoDosTitulos`); `--coverage` completo (~90s) não rodado.
- **Correções de premissas aplicadas no consolidado, não nas seções**:
  - **C1 (cron do Render duplicado)** — F-deployability-1 correto no diagnóstico; resolução é REVERTER o `render.yaml` (não "escolher um dos dois"). Findings resolvidos pela reversão marcados como tal e removidos do KANBAN: F-deployability-2, F-deployability-3, F-deployability-5, F-security-1, F-availability-1 (parte cron), F-availability-5 (parte cron). F-testability-4 (validação de `render.yaml` no CI) rescrito sem a premissa falsa "se o cron não subir, o `pago` para de ser recalculado" — o recálculo é dirigido pelo cron do GitHub, que já roda.
  - **C2 (F-fault-tolerance-2 pré-existente)** — atribuição corrigida: `IngestLockBusyError → exit 1` não é regressão introduzida aqui; `IngestaoPermutasService.ts:177` e `jobs/ingest-permutas.ts:32-40` já estavam assim. Card mantido por mérito (o padrão correto está em `reaper-sispag-reconciling.ts:27`).
  - **C3 (novo P0 na ordem de persistência)** — nenhum agente isolado pegou. Confirmado por leitura direta: `IngestaoPermutasService.toInvoiceRows` linha 323 vs. 337 (primeira passada vence). Card `permuta-persistence-1` criado como P0.
  - **C4 (atribuição do validate ao vivo)** — F-integrability-3 dizia "o Yuri rodou à mão"; foi o assistente durante a sessão do `/feature-tweak`. Corrigido nas citações do REPORT.
- **Deduplicações agressivas aplicadas**: `com308RowSchema` (F-integrability-1 + F-security-5) → card `integrability-1`. `catch {}` silencioso (F-availability-4 + F-fault-tolerance-1 + F-integrability-7) → card `fault-tolerance-1`. Probes fora do bundle (F-deployability-6 + F-security-4 parte gate) → card `security-3`.
- **Escopo temporal**: snapshot do dia 2026-08-28; código é vivo, refazer trimestralmente.
- **O que este pipeline NÃO cobre**: chaos engineering (nunca testamos "com308 fora do ar em plena run"), threat modeling formal, custo cloud, UX, acessibilidade, testes de carga contra HML.

## 8. Ações recomendadas

Ordem de execução para os próximos 30 dias. Somente **P0** re-entra no loop deste PR (Inviolable Rule #11); P1/P2/P3 vão para `ontology/_inbox/invoice-pago-detalhe-regis-followups.md`.

1. **Antes de mergear este PR — 3 cards P0 obrigatórios**:
   - `permuta-persistence-1` — corrigir a ordem em `IngestaoPermutasService.toInvoiceRows` (hidratada vence lista-crua). Sem isso, o fix não alcança o banco para invoices com adiantamento no processo. **Este é o bloqueador mais crítico.**
   - `deployability-1` — reverter o bloco `type: cron` do `render.yaml` (mantém apenas o cron do GitHub Actions que já roda em PRD). Um único commit resolve 7 findings.
   - `testability-1` — capturar fixtures reais do wire de Permutas + `contrato.test.ts`. Sem isso, R-3/R-4 têm chance ≈100% de reincidir.
2. **Sprint 1 pós-merge (~1 semana) — Quick wins P1 de alta alavancagem**:
   - `integrability-1` (Zod no boundary), `fault-tolerance-2` (exit 0 no lock-busy), `availability-1` (freshness UI), `performance-1` (instrumentação), `modifiability-2` (deprecar `isPago` trap), `testability-3` (promover validadores).
3. **Sprint 2 (~2 semanas) — Consolidação estrutural P1/P2**:
   - `modifiability-1` (invoicePagoResolver — consolida a regra e sela a raiz da reincidência), `integrability-2` (fallback ao detail), `fault-tolerance-1` (instrumentação de fallback + coluna `pago_source`), `fault-tolerance-3` (`status='partial'` emitido).
4. **Sprint 3 (~2 semanas) — Higienização de superfície e infra P2**:
   - `security-3` (probes fora do bundle), `security-4` (probes /tmp), `deployability-4` (kill-switch runtime do job), `testability-4` (lint `render.yaml`), `performance-4` (calibrar concorrência), `performance-2` (fail-loud no capHit), `testability-2` (unit tests diretos), `modifiability-3`/`modifiability-4` (extrair módulo + externalizar tolerância).
5. **Backlog (P3) — reduzir custos futuros**:
   - `testability-5` (quebrar `EleicaoPermutasService`), `testability-6` (loop probe→capture→contract), `integrability-3` (validator scheduled em CI), `integrability-6`/`integrability-7` (constants + probe enum), `modifiability-5` (business rule ontology), `deployability-7` (nodeVersion), `security-5` (runbook rotação), `availability-4` (Self-Test smoke), `performance-3` (documentar KPI payload).

**Uma frase-âncora para levar à reunião**: `Este PR corrige o sintoma da Simone no papel; para corrigir no banco precisamos de 1 fix de ordem de persistência (permuta-persistence-1), 1 reversão de render.yaml (deployability-1) e 1 contract test que impeça a reincidência (testability-1) — todos S, todos rebloqueadores, todos entram no loop deste PR.`
