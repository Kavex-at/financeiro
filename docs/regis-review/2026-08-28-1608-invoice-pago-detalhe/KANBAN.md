---
type: regis-review-kanban
run_id: 2026-08-28-1608-invoice-pago-detalhe
total: 33
counts: { p0: 3, p1: 9, p2: 14, p3: 7 }
---

# Kanban — financeiro — 2026-08-28-1608-invoice-pago-detalhe

> Importável para o Kanban do time. Cada card já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: P0 (S → XL), depois P1, P2, P3.
>
> **STATUS PÓS-REMEDIAÇÃO (commit `15a1351`):** `permuta-persistence-1` ✅ FEITO ·
> `deployability-1` ✅ FEITO · `fault-tolerance-1` ✅ PARCIAL (a parte do delta — o `catch` da
> hidratação deixou de ser silencioso; o contador `fallbackCount` e a coluna `pago_source`
> continuam abertos) · `testability-1` ⏳ ABERTO (único P0 remanescente).
>
> **Findings removidos (RESOLVIDOS PELA REVERSÃO do bloco `type: cron` do `render.yaml`, card deployability-1):**
> F-deployability-2, F-deployability-3, F-deployability-5, F-security-1, F-availability-1 (parte cron do Render), F-availability-5 (parte cron do Render).
>
> **Somente P0** re-entra no loop deste PR (Inviolable Rule #11). P1/P2/P3 → `ontology/_inbox/invoice-pago-detalhe-regis-followups.md`.

---

## P0 — Crítico

### [permuta-persistence-1] ✅ FEITO — Corrigir a ordem em `IngestaoPermutasService.toInvoiceRows`

**QA**: Modifiability + Fault Tolerance (cross-QA, novo card do consolidador)
**Tactic alvo**: Increase Semantic Coherence · Encapsulate
**Esforço**: S
**Findings**: novo P0 (não pego por agente isolado — confirmado por leitura direta em consolidação); relaciona F-modifiability-1, F-modifiability-2, F-integrability-4, F-testability-1

**Problema**
> `IngestaoPermutasService.toInvoiceRows` monta `permuta_invoice` em duas passadas: (linha 323) primeiro as invoices das candidatas; (linha 337) depois o universo hidratado com `if (byDocCod.has(inv.docCod)) continue`. **A entrada da candidata sempre vence.** As invoices das candidatas vêm de `listFinanceiroAPagar` → `mapDocPagar` → `ConexosBaseClient.isPago(row)` (`ConexosFinanceiroClient.ts:582`) — a MESMA fonte sempre-`false` do `com298/list` que este delta veio corrigir. Para toda INVOICE cujo processo tenha um adiantamento (justamente o universo alvo do produto), o `pago` derivado pelo `derivarPagoDosTitulos` **é sobrescrito** pela versão errada. O validador `validate-invoice-pago-detalhe-v1.ts` passou 80/80 porque exercita `derivarPagoDosTitulos` diretamente contra o com308, sem passar pelo caminho de persistência — ponto cego de wiring.

**Melhoria Proposta**
> Inverter a precedência em `toInvoiceRows`: iterar primeiro o universo HIDRATADO, depois complementar apenas os `docCod` não vistos com as invoices das candidatas. Adicionar teste em `IngestaoPermutasService.test.ts` com uma INVOICE paga chegando via candidata e assegurar que a row persistida tem `pago=true`.

**Resultado Esperado**
> Invoices com adiantamento no processo persistem `pago` real após a ingestão. O sintoma da Simone é efetivamente corrigido no banco, não apenas no papel.

**RESOLUÇÃO APLICADA (commit `15a1351`)**
> Implementado como mapa `pagoConfiavel` (docCod → pago do universo hidratado) consultado no `add()` das candidatas, com `?? inv.pago` preservando o piso conservador quando a invoice não está no universo. Preferido sobre a inversão de laços porque as candidatas continuam precisando entrar primeiro (carregam cliente/importador e o vínculo de casamento). 2 testes novos em `IngestaoPermutasService.test.ts`; o primeiro foi provado falhando sem o fix (`Expected: true, Received: false`).

**Métricas de sucesso**
- INVOICEs com adiantamento no processo cujo `pago` persistido vem do com308: ~0% → 100% ✅
- Teste de regressão do caminho candidata + hidratada: 0 → 2 ✅
- Ponto cego do validador de wiring: presente → coberto por unit test ✅

---

### [deployability-1] ✅ FEITO — Reverter o bloco `type: cron` do `render.yaml`

**QA**: Deployability
**Tactic alvo**: Logical Grouping
**Esforço**: S
**Findings**: F-deployability-1. Resolve também F-deployability-2, F-deployability-3, F-deployability-5, F-security-1, F-availability-1 (parte cron do Render), F-availability-5 (parte cron do Render).

**Problema**
> `.github/workflows/ingest-permutas.yml` (em `origin/main`, `cron '0 9,15,21 * * *'` UTC = 06:00/12:00/18:00 BRT, `success` diário verificado) já cobre a cadência de ingestão. O cabeçalho do workflow diz textualmente: "Cron GRATUITO via GitHub Actions (Render Cron Job é pago)". Este delta acrescentava `render.yaml` com `schedule: '0 9 * * *'` UTC — colisão exata com o tick das 06:00 BRT, custo de plano pago sem benefício, 10 chaves de env duplicadas e envs de escrita num job read-only.

**Melhoria Proposta**
> Remover integralmente o bloco `- type: cron` de `render.yaml`. A única cadência remanescente passa a ser o cron do GitHub Actions.

**Resultado Esperado**
> 0 execuções concorrentes na janela 06:00 BRT; 0 `IngestLockBusyError` diário; custo Render cron → R$0; 10 chaves duplicadas → 0.

**RESOLUÇÃO APLICADA (commit `15a1351`)**
> `git checkout origin/main -- render.yaml`. O arquivo voltou a ser byte-idêntico a `origin/main` (`git diff origin/main -- render.yaml` vazio); `grep -c "type: cron"` = 0.

**Métricas de sucesso**
- Execuções concorrentes/dia: 2 → 0 ✅
- Chaves duplicadas no `render.yaml`: 10 → 0 ✅
- Envs de escrita em processos read-only: 2 → 0 ✅

---

### [testability-1] ⏳ ABERTO — Capturar fixtures reais do wire de Permutas + contract test

**QA**: Testability
**Tactic alvo**: Record/Playback (Recordable Test Cases) · Abstract Data Sources
**Esforço**: M
**Findings**: F-testability-1, F-testability-6

**Problema**
> O bug `invoice-pago-detalhe` sobreviveu 62 dias (entre a introdução em `634eef0` em 2026-06-24 e o report da Simone em 2026-08-25) porque os 269 mocks hand-typed nos 11 testes de `domain/service/permutas/*.test.ts` sempre desenharam INVOICE com campos preenchidos, quando o `com298/list` real devolve `mnyTitAberto: null` em 1146/1146 casos. O mesmo tipo de fixture congelada que existe em `sispag/__fixtures__/` (16 JSON + `contrato.test.ts`) e em `recebimentos/__fixtures__/` (4 arquivos) **não existe para Permutas**.

**Melhoria Proposta**
> Portar o padrão do SISPAG para Permutas: (a) `src/backend/jobs/capture-fixtures-permutas.ts` (análogo ao `capture-fixtures-sispag.ts`, com redação por tipo, ESTRITAMENTE read-only sobre `com298/list tpdCod=127/128`, `com308/.../list/{docCod}`, `getDetalheTitulos`); (b) `src/backend/domain/interface/permutas/__fixtures__/` com JSON datados + `contrato.test.ts` amarrando os campos consumidos pelo código.

**Resultado Esperado**
> Fixtures capturados 0 → ≥ 8; `contrato.test.ts` em Permutas 0 → 1; próximo defeito de contrato do ERP detectado por `npm test`, não pela analista. MTTD de mudança de schema Conexos: >30d → ≤1d.

**Métricas de sucesso**
- Fixtures em `src/backend/domain/interface/permutas/__fixtures__/`: 0 → ≥ 8
- Contract test: 0 → 1 (com ≥ 5 shapes cobertos)
- Mocks hand-typed substituídos por hidratação a partir de fixture: 0 → ≥ 20%

**Risco de não fazer**
> Mais uma versão do mesmo bug reincide em 3-6 meses num terceiro caminho; ciclo 2026-06-18 → 2026-06-21 → 2026-06-24 → 2026-08-25 se repete.

**Dependências**: Nenhuma.

---

## P1 — Alto

### [integrability-1] Aplicar `com308RowSchema` no mapper de `listTitulosAPagar` (dedupe: consolida F-security-5)

**QA**: Integrability + Security · **Tactic**: Adhere to Standards · Validate Input · **Esforço**: S
**Findings**: F-integrability-1, F-security-5

**Problema**
> `com308RowSchema` foi ampliado neste delta (`+ titMnyTotPago`) mas continua decorativo — `ConexosTitulosClient.listTitulosAPagar` não o importa nem invoca (`grep -c "safeParse|\.parse("` = 0). O irmão `ConexosSispagClient` usa `.parse` em 9 lugares; 10 de 12 clients Conexos aplicam Zod no boundary. Uma mudança silenciosa do wire (locale `"1,23"`, envelope `{value: 123}`, sentinel negativo) devolve `undefined`/valor absurdo em `parseOptionalNumber` e reintroduz o bug corrigido, sem alarme.

**Melhoria Proposta**
> Aplicar `com308RowSchema.safeParse(r)` no `.map` de `listTitulosAPagar`. Row inválida → `logService.warn` (BUSINESS_WARN com endpoint + docCod + issues) e ignorar. Complementar `wireNumber` com `.refine(n => n >= 0, 'valor financeiro negativo')`.

**Resultado Esperado**
> 100% das rows do com308 passam por Zod. `titMnyTotPago` negativo ou `pago > face` vira BUSINESS_WARN em vez de sombra numérica em decisão financeira.

**Métricas de sucesso**
- Rows validadas por Zod em `listTitulosAPagar`: 0 → 100%
- Clients Conexos com Zod no boundary: 10/12 → 11/12

---

### [integrability-2] Contratar `titMnyTotPago` como opcional e cair para `getDetalheTitulos` quando ausente

**QA**: Integrability + Fault Tolerance · **Tactic**: Tailor Interface · **Esforço**: M
**Findings**: F-integrability-2

**Problema**
> `listTitulosAPagar` agora depende de `titMnyTotPago` no `fieldList` explícito. O repo tem histórico documentado (`ConexosFinanceiroClient.ts:406-413`) de colunas rejeitadas via `ORA-00904` quando listadas. Se `titMnyTotPago` cair na mesma armadilha, o POST volta 400/500 e derruba `pago` + taxa + `valorNegociado` nos 4 consumidores do método.

**Melhoria Proposta**
> (a) telemetria: logar `rowsSemTitMnyTotPago` por run; (b) fallback tático: se ≥X% das rows vier sem o campo, cair para `getDetalheTitulos({docCod})` (caminho já existente do Gate 3). Custo: +1 GET por invoice só quando degrada.

**Resultado Esperado**
> Blast radius de uma quebra no com308: 4 features → 1 (com fallback automático).

**Dependências**: `integrability-1`.

---

### [fault-tolerance-1] ✅ PARCIAL — Instrumentar o fallback conservador de `pago`

**QA**: Fault Tolerance + Availability + Integrability · **Tactic**: Condition Monitoring · Quarantine · **Esforço**: M
**Findings**: F-fault-tolerance-1, F-availability-4, F-integrability-7 (deduplicados)

**Problema**
> Quando o com308 falha para uma invoice, a linha é persistida com `pago=false` e fica indistinguível das legitimamente em-aberto. O `catch` era vazio, o header da run continua `'success'`, e não há coluna registrando a fonte do `pago`.

**RESOLUÇÃO PARCIAL (commit `15a1351`)**
> Os dois ramos do `hidratarInvoiceNegociada` deixaram de ser silenciosos: `catch (error)` emite `BUSINESS_WARN` com docCod/filCod/erro, e o ramo `pagoDosTitulos === undefined` emite warn próprio. **Continuam abertos:** os catches de `EleicaoPermutasService.ts:563,858` e `AlocacaoPermutasService.ts:149`; o contador `fallbackCount` propagado ao `FLOW_COMPLETE`; e a coluna `permuta_invoice.pago_source`.

**Melhoria Proposta (restante)**
> (1) mesmo tratamento nos 3 catches remanescentes; (2) `fallbackCount` no `IngestaoResult` + `FLOW_COMPLETE` + `IngestRunHeader`; (3) migration `permuta_invoice.pago_source text CHECK (pago_source IN ('titulo','fallback'))`.

**Métricas de sucesso**
- Catches silenciosos no caminho `pago`: 4 → 2 (meta: 0)
- Contador de fallback em `FLOW_COMPLETE`: ausente
- Coluna discriminadora de fonte: ausente

---

### [fault-tolerance-2] Cron da ingestão distingue "lock ocupado" de "falha real" — exit 0 + warn

**QA**: Fault Tolerance + Availability · **Tactic**: Sanity Checking · **Esforço**: S
**Findings**: F-fault-tolerance-2, F-availability-2 (deduplicados)

> **Atribuição corrigida (C2)**: NÃO é regressão deste delta. `IngestaoPermutasService.ts:177` e `jobs/ingest-permutas.ts:32-40` já estavam assim; o cron do GitHub Actions já expõe o defeito diariamente.

**Problema**
> `jobs/ingest-permutas.ts:31-38` trata qualquer erro como falha e chama `process.exit(1)`. `IngestLockBusyError` é lançado quando o cron esbarra em trigger manual — o próprio erro documenta "It is NOT a failure". No agendador, vira "failed" e polui o histórico.

**Melhoria Proposta**
> `catch` que detecta `IngestLockBusyError` e sai com code 0 (log `info`), demais erros seguem com code 1. Espelha `jobs/reaper-sispag-reconciling.ts:27`.

**Resultado Esperado**
> Corrida benigna cron×analista não gera "failed execution" nem alerta ruidoso.

---

### [modifiability-1] Centralizar a regra "invoice/adiantamento está pago?" num módulo canônico

**QA**: Modifiability + Integrability + Fault Tolerance · **Tactic**: Abstract Common Services · Increase Semantic Coherence · **Esforço**: M
**Findings**: F-modifiability-1, F-modifiability-4, F-modifiability-6, F-integrability-4

**Problema**
> A regra está em 3 call-sites com 3 fontes e 3 políticas de fallback. **Terceira reincidência** da mesma classe (01b99bf → df90fa6 → 48abd7b). A vista mostrou ~75% de invoices liquidadas por semanas.

**Melhoria Proposta**
> Extrair `src/backend/domain/service/permutas/invoicePagoResolver.ts` (função pura) com API `resolver({ getDetalhe, listTitulos, rowList }) → { pago, fonte, razao }`. Migrar os 3 call-sites.

**Resultado Esperado**
> 3 call-sites → 1 fórmula única. Mudança de tolerância/fonte/ordem toca **1 arquivo**.

**Métricas de sucesso**
- Call-sites que decidem "invoice pago": 3 → 1 + N consumidores
- Fontes distintas: 3 → 2 (detalhe preferido, títulos fallback; list nunca)

---

### [modifiability-2] Neutralizar a armadilha do `ConexosBaseClient.isPago()` sobre `com298/list`

**QA**: Modifiability + Integrability · **Tactic**: Encapsulate · Restrict Dependencies · **Esforço**: S
**Findings**: F-modifiability-2

**Problema**
> `isPago(row)` continua público e é chamado por `ConexosFinanceiroClient.ts:441,582`, populando `DocFinanceiroAPagar.pago` com o boolean do `com298/list` — provado inservível (`mnyTitAberto` null em 1146/1146). O nome promete o que a fonte não entrega. É a armadilha por trás do R-1.

**Melhoria Proposta**
> (a) renomear para `isPagoFromDetailRow(row)` com JSDoc explícito; (b) `mapDocPagar` para de setar `pago`; (c) `DocFinanceiroAPagar.pago` vira opcional.

**Métricas de sucesso**
- Call-sites de `isPago(rowCom298List)`: 2 → 0
- `DocFinanceiroAPagar.pago` opcional: não → sim

---

### [availability-1] Alerta de frescor da ingestão (freshness UI + endpoint health) [rescrito pós-reversão]

**QA**: Availability · **Tactic**: Monitor · Condition Monitoring · **Esforço**: S
**Findings**: F-availability-3

**Problema**
> `findLatestIngestFinishedAt()` já existe (`PermutaSnapshotRepository.ts:260-269`) e é lido em `GestaoPermutasService.ts:61`, mas não há comparador `age > threshold`. A UI mostra a data via `formatRunWhen` sem sinalizar degradação. Se o cron do GH parar, a analista aceita silenciosamente o carimbo desatualizado.

**Melhoria Proposta**
> (1) `GET /permutas/health` devolvendo 503 se `age > 24h`; (2) badge visual em `page.tsx:648-655` (amarelo >24h, vermelho >48h).

**Métricas de sucesso**
- MTTD de "cron não rodou": ∞ → < 24h

---

### [performance-1] Instrumentar duração e contagem de requests do cron de ingestão

**QA**: Performance · **Tactic**: Bound Execution Times · **Esforço**: S
**Findings**: F-performance-1, F-performance-5

**Problema**
> ~3.438 chamadas Conexos por run capadas por ~3 sessões; wall-time estimado 11–13 min sem instrumentação. Se estourar 2h invade o horário comercial e compete com `/permutas/gestao` e Frentes III/IV.

**Melhoria Proposta**
> `conexos_requests_total{endpoint}`, `conexos_login_errors_total{type}`, `per_filial_duration_ms` no `FLOW_COMPLETE`; timeout global via o `AbortController` que já existe no fan-out.

**Métricas de sucesso**
- Wall-time p95: desconhecido → medido, alerta se > 15 min
- Runs que invadem 08:00 SP: desconhecido → 0

---

### [testability-3] Promover os 8 `validate-*.ts` a `.integration.test.ts` opt-in

**QA**: Testability + Integrability · **Tactic**: Sandbox · Recordable Test Cases · **Esforço**: M
**Findings**: F-testability-3, F-integrability-3

**Problema**
> 8 validadores rodam só via `tsx jobs/…`; sem npm script, sem cadência, sem CI, sem registro de última execução. A certificação "80/80" vale para o dia.

**Melhoria Proposta**
> Cada validador vira `.integration.test.ts` com `describe.skipIf(!process.env.PROBE_ALLOW_PRD)`. Adicionar `npm run test:integration:prd` e workflow `workflow_dispatch` com aprovação humana.

**Métricas de sucesso**
- Validadores executáveis via Jest: 0/8 → 8/8

---

## P2 — Médio

### [fault-tolerance-3] Ingestão emite `status='partial'` quando N invoices caem no fallback
**Tactic**: Sanity Checking · **Esforço**: S · **Findings**: F-fault-tolerance-3
> `IngestRunHeader.status` declara `'success' | 'partial' | 'error'` mas `'partial'` nunca é emitido. Uma run com 30% no fallback é gravada como `success` — auditoria mente.
> **Proposta**: após `fallbackCount` (card `fault-tolerance-1`), setar `status = fallbackCount > 0 ? 'partial' : 'success'`.
> **Dependências**: `fault-tolerance-1`.

### [fault-tolerance-4] Agendar `validate-invoice-pago-detalhe-v1` como reconciliação semanal
**Tactic**: Comparison · Reconcile · **Esforço**: S
> Validador roda on-demand. **Proposta**: workflow semanal (sábado noturno); exit 1 só em divergência real; falha abre issue.
> **Resultado**: janela `regra quebra → alguém sabe`: indefinida → ≤ 7d.

### [integrability-4] Documentar qual caminho persiste `pago` e por que só ele aplica a correção
**Tactic**: Orchestrate · Encapsulate · **Esforço**: S · **Findings**: F-integrability-4
> 3 call-sites de `listTitulosAPagar` no mesmo service; só `hidratarInvoiceNegociada` aplica a derivação. Assimetria intencional mas não documentada — mesmo tipo de suposição não-marcada que gerou este bug.
> **Proposta**: docblock em `fetchInvoicesBatched` e no par adto/inv + teste de contrato.

### [performance-2] Falhar alto quando `listInvoicesFinalizadas.capHit === true`
**Tactic**: Bound Queue Sizes · **Esforço**: S · **Findings**: F-performance-2
> `capHit` é só WARN e a run segue; `markStale` some com invoices legítimas se o universo truncar. Filial 2 usa 4,6% do teto hoje.
> **Proposta**: `throw UniversoTruncadoError` — run falha, ROLLBACK preserva o dia anterior.

### [performance-4] Alinhar concorrência ao pool real de sessões Conexos
**Tactic**: Increase Concurrency (calibrada) · **Esforço**: M · **Findings**: F-performance-1
> 50 workers teóricos vs. ~3 slots reais. **Proposta**: `CONEXOS_SESSION_SLOTS=3` como constante única, ou semáforo real via `ConexosSessionRegistry`.
> **Dependências**: `performance-1`.

### [deployability-4] Kill-switch runtime `PERMUTAS_INGEST_ENABLED` lido pelo job [rescrito pós-reversão]
**Tactic**: Rollback · Removal from Service · **Esforço**: S · **Findings**: F-deployability-4, F-availability-5
> Pausar o cron do GH hoje exige editar workflow + commit (~5 min). Precedente: `SISPAG_LIVE_WRITE_ENABLED`, `RECEBIMENTOS_ENABLED`.
> **Proposta**: flag no `EnvironmentProvider` (fail-safe: ausente = habilitado), checada no início do job.
> **Resultado**: MTTR de pausa: ~5min → <60s.

### [security-3] Sondas de PRD fora do bundle + gate estruturado (dedupe: F-deployability-6)
**Tactic**: Limit Access · Package Dependencies · **Esforço**: S · **Findings**: F-security-4, F-deployability-6
> `tsconfig.json:24` (`include: **/*.ts`, sem exclude) compila 32+ probes/validators para `dist/jobs/`. Gate é boolean simples e usa `console.error`, não `LogService`.
> **Proposta**: `exclude` no tsconfig; exigir `PROBE_OPERATOR=<nome>`; emitir `LogService.warn` antes de qualquer chamada ao ERP.
> **Métrica**: `dist/jobs/probe-*.js` 32+ → 0.

### [security-4] Sondas escrevem em `/tmp` sem TTL/rotação — endurecer artefato
**Tactic**: Limit Exposure · **Esforço**: S · **Findings**: F-security-2, F-security-3
> `probe-invoice-pago.ts:243` grava `achados.json` com rows crus (nomes de exportador/importador, valores, priCod) sem chmod/unlink/TTL; `registrar()` loga as mesmas rows.
> **Proposta**: `unlink` no `finally`, `chmod 600`, sanitizar (`pesCod` → hash curto, esconder nomes), documentar no header.
> **Dependências**: idealmente após `security-3`.

### [modifiability-3] Extrair `derivarPagoDosTitulos` para módulo próprio
**Tactic**: Split Module · **Esforço**: S · **Findings**: F-modifiability-3, F-modifiability-4
> Função pura exportada do topo do orquestrador só porque o validador precisou importá-la — arrasta `tsyringe` e clients por transitividade.
> **Proposta**: `pagoInvoice.ts` (ou já o `invoicePagoResolver.ts`) com `derivarPagoDosTitulos`, `somaValorNegociado`, `siglaMoedaNegociada` + testes próprios.
> **Métrica**: named-exports em `EleicaoPermutasService.ts`: 1 → 0.

### [modifiability-4] Externalizar a tolerância de resíduo para configuração
**Tactic**: Defer Binding · **Esforço**: S · **Findings**: F-modifiability-5
> `face − pago === 0` é magic-0 inline — decisão de NEGÓCIO (`residual-pago-centavos`, 2026-06-18) cravada em código.
> **Proposta**: `PERMUTAS_TOLERANCIA_PAGO_BRL` no `EnvironmentProvider` (default 0); função pura recebe `(titulos, { tolerancia })`.

### [testability-2] Cobrir `derivarPagoDosTitulos` com unit tests diretos
**Tactic**: Executable Assertions · **Esforço**: S · **Findings**: F-testability-2
> Ramo `titulos.length === 0` não exercitado; 0 unit tests diretos da função pura.
> **Proposta**: `derivarPagoDosTitulos.test.ts` com 6 casos.
> **Métrica**: cobertura de ramo 5/6 → 6/6.

### [testability-4] Validar `render.yaml` no CI [rescrito sem a premissa falsa]
**Tactic**: Executable Assertions · **Esforço**: S · **Findings**: F-testability-4
> Sem lint/validação do blueprint em CI. Erro tipográfico ou `startCommand` sem npm script só aparece no deploy.
> **Proposta**: `yamllint render.yaml` + assert de que todo `startCommand` existe no `package.json` e que segredos usam `sync: false`.

### [testability-5] Quebrar `EleicaoPermutasService` (950 LOC) em subserviços coesos
**Tactic**: Limit Structural Complexity · **Esforço**: L · **Findings**: F-testability-5, F-modifiability-3
> 950 LOC / teste 1063 LOC; cognitive complexity 65 em `buildCandidata` (teto 15). O atrito empurra o autor a copiar mocks hand-typed.
> **Métrica**: service 950 → ≤500 LOC; teste 1063 → ≤500 LOC; mocks 269 → ≤180.
> **Dependências**: após `testability-1`.

### [testability-6] Fechar o loop probe → capture → contract → service test
**Tactic**: Recordable Test Cases · **Esforço**: S · **Findings**: F-testability-6
> Neste PR o probe e o validador foram feitos, mas "capture" e "contract" foram pulados — os números reais do doc 14042 foram transcritos à mão.
> **Proposta**: congelar saída de probe em `permutas/__fixtures__/YYYY-MM-DD-<endpoint>.json`; checklist no template de PR.
> **Dependências**: `testability-1`.

---

## P3 — Baixo

### [availability-4] Self-Test (smoke ao com308) no início do cron
**Tactic**: Self-Test · **Esforço**: S
> Com o com308 fora, o job varre ~1146 invoices/filial antes de chegar ao fallback em massa.
> **Proposta**: preflight `listTitulosAPagar` numa invoice canônica antes do fan-out; exit distinto sem tocar no modelo relacional.

### [performance-3] Documentar o ganho de payload em `/permutas/gestao` como KPI
**Tactic**: Reduce Overhead · **Esforço**: S · **Findings**: F-performance-3
> Payload estimado cai ~1.146 → ~287 linhas (~75%) e o índice parcial volta a ser seletivo, mas a vitória fica não medida.
> **Proposta**: medir bytes/linhas/latência p50-p95 antes-depois e registrar em `docs/impacto/`.
> **Bloqueado por**: `permuta-persistence-1` (medir só faz sentido com o `pago` correto no banco) — **agora desbloqueado**.

### [integrability-6] Extrair `titVldStatus#EQ '1'` para `conexosPermutasConstants.ts`
**Tactic**: Abstract Common Services · **Esforço**: S · **Findings**: F-integrability-5
> Filtro inline em `ConexosTitulosClient.ts:257` enquanto os irmãos vivem no arquivo de constantes. Inviolable Rule #2 em espírito.

### [integrability-7] Sondar a semântica do enum `pago` do com308 (1/2/3)
**Tactic**: Tailor Interface · **Esforço**: S · **Findings**: F-integrability-6
> Valores 1/2/3 observados (21/2/7 em 30) sem significado decodificado. A derivação atual (identidade monetária) está validada 80/80, mas o campo autoritativo do ERP fica no escuro.
> **Proposta**: `jobs/probe-com308-enum-pago.ts` cruzando o enum com a identidade em amostra > 500.

### [modifiability-5] Registrar `invoice-pago-derivation` como business-rule na ontologia
**Tactic**: Restrict Dependencies (governance) · **Esforço**: S · **Findings**: F-modifiability-6
> Não há business-rule canônica estabelecendo fórmula, fonte preferida e política de fallback — narrativa em `integrations/conexos.md` não é invariante.
> **Métrica**: `business_rules_total` 19 → 20.

### [deployability-7] Pinar `nodeVersion` no `render.yaml`
**Tactic**: Reproducible builds · **Esforço**: S · **Findings**: F-deployability-7
> `runtime: node` sem `nodeVersion`; CI pinia Node 24. Troca de default do provider quebra o deploy com CI verde.

### [security-5] Runbook de rotação de credenciais Conexos
**Tactic**: Revoke Access · **Esforço**: S · **Findings**: F-security-1 (reformulado)
> Sem checklist, a próxima rotação esquece um passo e a ingestão para silenciosamente.
> **Proposta**: `docs/runbooks/rotacao-credenciais-conexos.md` com passos ordenados + verificação de que o cron do GH voltou verde.
