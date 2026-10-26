---
qa: Integrability
qa_slug: integrability
run_id: 2026-10-26-1700-sispag-boleto-agrupado
agent: qa-integrability
generated_at: 2026-10-26T17:00:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP (fin010/fin015) | Mudança no shape da resposta (campo renomeado, código novo em `borVldFinalizado`, inversão de `itemy`, novo tipo de `QUESTION`, `borCod` reusado) ou do canal de retorno (fin052 muda a coluna que carrega `borCod`/`itsCodSeq`) | `ConexosBaixaClient` (fin010 escrita/leitura do borderô do grupo), `ConexosSispagWriteClient` (fin015 `borderosPendentes/importar`, `finItemSispag` PUT, `lerItemDeBordero`), `CasamentoRetornoGrupo` | Produção: 1ª execução PRD do boleto agrupado ainda não ocorreu; HML provou só o caminho `canonico` (6/6, borderô 253) | Zod no boundary recusa, `ConexosError`/`RascunhoLeituraIncompletaError` sobe, ledger write-ahead do grupo marca falha/`erro` e a remessa segue com os demais grupos; retomada relê pela identidade (`borCod+borTimCad`); linha de retorno sem `borCod` nunca casa com grupo | 0 pagamentos duplicados; 0 grupos marcados `pago` sem prova em `fin064`; marginal cost de adaptar a 1 novo shape do ERP = alterar 1 schema Zod + 1 teste de contrato por campo; HML `falha`/`retomada`/`v7` ainda PENDENTES (fonte: `_shared-metrics.md`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos públicos de domínio novos nos clients (sem vazamento de HTTP genérico) | +12 (`criarBorderoDoGrupo`, `gravarBaixaSimples`, `buscarBorderosNaJanela`, `buscarBorderoPorIdentidade`, `listBaixas`, `excluirBaixa`, `excluirBordero`, `getBordero` ampliado; `listarBorderosPendentes`, `importarBorderoPendente`, `lerItemDeBordero`, `editarItemDoRascunho`) — zero métodos públicos `get/post/request` leakando | 0 generic HTTP leakage | ✅ | `src/backend/domain/client/ConexosBaixaClient.ts:117-801`; `src/backend/domain/client/ConexosSispagWriteClient.ts:282-1704` |
| Schemas Zod novos no boundary (feature) | 7 (`BORDERO_IDENTIFICADO_SCHEMA`, `BAIXA_GRAVADA_SCHEMA` reforçado, `PENDENTE_BORDERO_SCHEMA`, `ITEM_BORDERO_SCHEMA`, `ITS_COD_SEQ_SCHEMA`, `BOR_COD_SCHEMA`, `EPOCH_MS`) | ≥1 Zod por write/read novo | ✅ | `ConexosBaixaClient.ts:28-83`; `ConexosSispagWriteClient.ts:198-230` |
| Versionamento explícito das URLs Conexos | 0% (`fin010`, `fin015/...` sem segmento `/v<N>` nem header de versão) | 100% (quando o provider suportar) | ❌ débito pré-existente, não introduzido pela feature | grep em `src/backend/domain/client/Conexos*.ts` |
| Testes de contrato do borderô do grupo (jest, mocks + snapshot do corpo) | 17 em `ConexosSispagWriteClient.bordero.test.ts`; 26 em `ConexosBaixaClient.test.ts` (grupo + Permutas) | ≥1 por método novo + snapshot do body | ✅ (unit) / ⚠️ (fixture-based) | `grep -c "it(" src/backend/domain/client/ConexosSispagWriteClient.bordero.test.ts` → 17; `ConexosBaixaClient.test.ts` → 26 |
| Fixtures de wire real (HAR/`__fixtures__`) para os endpoints novos | 1 (`2026-10-14-fin015-vinculo-codbar.json`, de task anterior) | ≥1 por response-shape do grupo (criarBorderoDoGrupo, listarBorderosPendentes, importar, borderosPendentes/list.rows com `borCod`) | ⚠️ parcial — os testes do grupo usam corpos sintetizados a partir das sondas HML, não um JSON gravado | `ls src/backend/domain/client/__fixtures__/` |
| HML — fases provadas vs. especificadas | `canonico` 6/6; `falha`, `retomada`, `v7`, PRD GT1/GT2 **PENDENTES** | 4/4 + PRD | ⚠️ | `docs/regis-review/.../_shared-metrics.md` |
| Falhas transitórias classificadas separadamente (não confundem "ausência") | `ConexosBaixaClient.classificarFalha` + `buscarBorderoPorIdentidade` sabem que `500 RECORDNOTFOUND` NÃO prova ausência; `GET fin010/{filCod}/{borCod}` nunca é oráculo (usa `list`) | 1 classificação por família de erro | ✅ | `ConexosBaixaClient.ts:137-153,325-346` |
| Observability per-dependency (taxa de erro por endpoint, parse-failures de Zod) | ⚠️ **Não medível localmente** — não há métrica dedicada; o `LogService.warn` só dispara em truncamento (`ConexosSispagWriteClient.ts:783-789`); as `ZodError` dentro do `catch` viram `ConexosError` sem contador agregado | 1 contador por `(endpoint, erro)` | ⚠️ | — |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Clients expõem **métodos de domínio** (`criarBorderoDoGrupo`, `importarBorderoPendente`, `gravarBaixaSimples`), nunca `post/get/request`; família por endpoint (`ConexosBaixaClient` = fin010, `ConexosSispagWriteClient` = fin015) | ✅ | `ConexosBaixaClient.ts:117`, `ConexosSispagWriteClient.ts:282-294` |
| Use an Intermediary | `ConexosBaseClient` concentra `postGeneric`/`postGenericOnce`/`putGenericOnce`/`runWithRetry`/`ensureSid`; `BorderoGrupoBoletoService` é intermediário entre `RemessaService` e os dois clients Conexos (write-ahead + retomada) | ✅ | `ConexosBaixaClient.ts:118-132`; `RemessaService.ts:263-265,1373-1433` |
| Restrict Communication Paths | `RemessaService` só fala com Conexos via `BorderoGrupoBoletoService`/`VinculoCodigoBarrasService`; o retorno (`fin052`) casa com grupo exclusivamente via `CasamentoRetornoGrupo` (sem acesso direto ao client) | ✅ | `CasamentoRetornoGrupo.ts:34-62` |
| Adhere to Standards | CNAB-240 gerado pelo próprio Conexos (`gerArquivosBancos/gerarRemessa`); linha digitável validada contra FEBRABAN (DVs mod-10 e mod-11) no client antes de qualquer `PUT` | ✅ | `ConexosSispagWriteClient.ts:108-160` |
| Abstract Common Services | Doutrina de escrita irreversível (`postGenericOnce` + sem `RetryExecutor`) compartilhada entre fin010 (criar/baixa) e fin015 (lote, importar, gerar remessa) — mesmo contrato para IDE/retry/401 nos dois endpoints novos; a releitura por identidade `fin010/list` substitui o `GET` em qualquer novo endpoint que precisar | ✅ | `ConexosBaixaClient.ts:102-114,163-168`; `ConexosSispagWriteClient.ts:263-281,1017-1042` |
| Discover Service | Credenciais e URL via `EnvironmentProvider` (SSM-ready) + `conexosWriteEnabled` fail-closed; nada hardcoded no delta | ✅ | `ConexosBaixaClient.ts:155-158`; `ConexosSispagWriteClient.ts:296-299` |
| Tailor Interface | Zod no boundary adapta o shape heterogêneo do Conexos (envelope `data`, `.responseData`, `preprocess` para desembrulhar) e emite tipos locais estáveis para o service — mudança de shape = alterar schema, não o service | ✅ | `ConexosSispagWriteClient.ts:36-45,169-195`; `ConexosBaixaClient.ts:53-83` |
| Configure Behavior | `conexosWriteEnabled` + `SISPAG_LIVE_WRITE_ENABLED` + `SISPAG_BIND_CODBAR_FILIAIS` governam a borda; o client recusa (`ConexosWriteDisabledError`) ANTES de qualquer POST do grupo | ✅ | `ConexosBaixaClient.ts:155-158`; `ConexosSispagWriteClient.ts:1017-1018` |
| Manage Resources | `runWithRetry` só em leitura; escrita (bordero, baixa, importar, PUT, finalizar, gerar remessa) sempre `postGenericOnce`/`putGenericOnce`/`deleteGeneric` — tentativa única. Paginação com guard `maxPaginas` em todas as varreduras novas (`listarBorderosPendentes`, `lerLinhasDoRascunho`, `varrerLotes`). | ✅ | `ConexosBaixaClient.ts:166-243,529-547`; `ConexosSispagWriteClient.ts:452-583,952-998` |
| Orchestrate | `RemessaService.prepararBorderosDosGrupos` + `vincularBarrasDosGrupos` + `exigirGruposConferidos` dão ordem linear fail-safe antes do `finalizarLote` (I21p: nenhuma escrita após uma conferência falha) | ✅ | `RemessaService.ts:1350-1433` |
| Manage Resource Coupling | A identidade do borderô do grupo (`borCod+borTimCad`) fica no ledger local (`GrupoBoletoExecucaoRepository`); o ERP pode reusar `borCod` sem corromper o estado (write-ahead nunca troca uma identidade gravada por outra) | ✅ | `GrupoBoletoExecucaoRepository.ts:130-200,307-331` |
| Contract testing | 17 testes (fin015 grupo) + 11 testes dedicados ao grupo em `ConexosBaixaClient.test.ts`; cobrem shape de sucesso (snapshot do body), falhas de contrato (Zod), `QUESTION` do ERP, janela `borTimCad`, `ALHEIO`/`AUSENTE`/`PRESENTE`. **Mas** usam objetos sintetizados — fixtures de wire real HAR só existem para `vinculo-codbar` (tarefa anterior). | ⚠️ parcial | `ConexosSispagWriteClient.bordero.test.ts`; `ConexosBaixaClient.test.ts:181-498` |
| Versioning strategy | O Conexos não expõe versão de API nos endpoints novos (`fin010`, `fin015/...`); o campo `conexos.ontology-version` do delta cobre a nossa ontologia, não o contrato ERP | ⚠️ ausente (débito pré-existente) | grep em `src/backend/domain/client/Conexos*.ts` |
| Backward-compatibility shims | `preprocess` que aceita `raw.data ?? raw` e `raw.responseData ?? raw` já é um shim leve; `SituacaoBorderoFin010.classificar` encapsula o mapa `borVldFinalizado × borCodNovo` — se o ERP introduzir `4 = suspenso`, o default é `INDETERMINADO` (fail-closed) | ✅ | `ConexosSispagWriteClient.ts:36-45,169-195`; `SituacaoBorderoFin010.ts:18-36` |
| Observability of integration failures | Zero métrica agregada por `(endpoint, erro)`; só o `LogService.warn` de truncamento. ZodError no `.parse()` sobe como `ConexosError` sem contador. | ❌ | `ConexosSispagWriteClient.ts:783-789`; `.parse()` em `ConexosBaixaClient.ts:185,232,292,374,797` |

## 4. Findings

### F-integrability-1: Fixture-based contract tests do borderô do grupo baseadas em sondas HML sintetizadas, não em HAR real

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.bordero.test.ts`; `src/backend/domain/client/ConexosBaixaClient.test.ts:181-498`; `src/backend/domain/client/__fixtures__/` (único JSON: `2026-10-14-fin015-vinculo-codbar.json`)
- **Evidência**:
  ```
  $ ls src/backend/domain/client/__fixtures__/
  2026-10-14-fin015-vinculo-codbar.json
  $ grep -c "it(" ConexosSispagWriteClient.bordero.test.ts ConexosBaixaClient.test.ts
  17 / 26  (todos com corpos sintetizados)
  ```
  O HML provou só a fase `canonico` (6/6, borderô 253 — `_shared-metrics.md`); `falha`, `retomada`, `v7` e a medição PRD GT1/GT2 estão PENDENTES. Logo, o shape do `borderosPendentes/list.rows` em uma falha determinística, o shape da resposta `importar` sob 2ª tentativa com borderô já importado, e a resposta de `editarItemDoRascunho` com modalidade 7 (banco emissor ≠ banco do lote) foram testados contra mocks, não contra o wire gravado.
- **Impacto técnico**: Se o Conexos devolver uma variante não antecipada (ex.: `borderosPendentes` com `borCod` como string "1234", ou `importar` embrulhando a resposta em `.data`), o Zod falha hard e a remessa aborta — fail-safe, mas gera falso-positivo que só é diagnosticado olhando a `cause` do `ConexosError`.
- **Impacto de negócio**: Primeira execução PRD pode travar o lote com erro de contrato que o teste unitário não cobria. Operador refaz a remessa manualmente; perda de janela de corte D-0.
- **Métrica de baseline**: 1 fixture HAR real para 12+ métodos novos (razão 1:12).

### F-integrability-2: Sem observabilidade por endpoint de falhas de parse Zod (write-side do grupo)

- **Severidade**: P2
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/domain/client/ConexosBaixaClient.ts:185,232,292,374,797`; `src/backend/domain/client/ConexosSispagWriteClient.ts:407,981,1067,1100`
- **Evidência**: Cada `.parse(raw)` dentro de `try/catch` reembrulha a `ZodError` em `ConexosError` sem contador agregado. Único log estruturado específico do boundary é o `warn` de truncamento (`ConexosSispagWriteClient.ts:783-789`). Nenhum `logService.error` com `type: INTEGRATION_PARSE_FAIL` ou similar.
- **Impacto técnico**: Erro de contrato recorrente passa despercebido até a reclamação do operador — não há dashboard de taxa de parse-failure por endpoint, logo não há sinal precoce de drift de shape.
- **Impacto de negócio**: MTTD alto no 1º incidente PRD pós-cutover do grupo (feature nunca rodada em PRD).
- **Métrica de baseline**: 0 contadores dedicados; `grep -rn "INTEGRATION_PARSE_FAIL\|BOUNDARY_SCHEMA_FAIL" src/backend` → 0 ocorrências.

### F-integrability-3: HML provou só o caminho canônico — V7 (modalidade 7, banco emissor ≠ banco do lote) não exercitado end-to-end

- **Severidade**: P1
- **Tactic violada**: Contract testing + Versioning strategy (comportamento diferencial do ERP)
- **Localização**: `src/backend/domain/client/ConexosSispagWriteClient.ts:1113-1143` (editarItemDoRascunho com `itsVldModalidade: 7`); `docs/regis-review/.../_shared-metrics.md`
- **Evidência**: `_shared-metrics.md` declara textualmente: "HML (2026-10-26): fase `canonico` 6/6 (borderô 253). `falha`, `retomada`, `v7` e a medição PRD GT1/GT2 PENDENTES." O `editarItemDoRascunho` tem lógica condicional para injetar `itsVldModalidade = 7` quando a barra traz banco ≠ banco do lote, mas o cenário V7 nunca foi corrido ao vivo. Comentário no código (linha 1109) confirma "só para banco emissor ≠ banco do lote, `itsVldModalidade = 7` (HML V4)" — a nota reutiliza a medição V4 e extrapola V7.
- **Impacto técnico**: Em PRD, o 1º boleto agrupado cujo código de barras venha de um banco diferente do banco do lote pode disparar `QUESTION` não antecipada (ex.: `PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_...`) → `ErpPerguntaError`, lote fica no rascunho até intervenção humana.
- **Impacto de negócio**: Primeiro grupo cross-bank em PRD trava a remessa; cutover do boleto agrupado deve ser gated.
- **Métrica de baseline**: 1/4 fases HML provadas (25%); 0/2 fases PRD medidas.

### F-integrability-4: Versionamento do Conexos ausente nos endpoints novos — assumido estável sem contrato

- **Severidade**: P3
- **Tactic violada**: Versioning strategy / Backward-compatibility shims
- **Localização**: Todas as chamadas novas: `fin010`, `fin015/finItemSispag/borderosPendentes/importar`, `fin010/list`, `fin015/finItemSispag` (PUT) — nenhuma com segmento `/v<N>` ou header de versão.
- **Evidência**: `grep -n "/v[0-9]" src/backend/domain/client/Conexos*.ts` → 0 ocorrências. Confirma débito pré-existente, mas a feature **ampliou a superfície** sem adicionar uma estratégia de pinning.
- **Impacto técnico**: Upgrade do Conexos a qualquer momento muda o shape sem aviso; a defesa é apenas o Zod reativo.
- **Impacto de negócio**: Trava correlacionada em várias filiais simultaneamente se o shape de `borderosPendentes` mudar (medir, acordar com o fornecedor, publicar shim é débito aberto).
- **Métrica de baseline**: 0% dos endpoints novos com versão explícita.

### F-integrability-5: CasamentoRetornoGrupo casa por `borCod` + `itsCodSeq` opcional — contrato observado em 1 arquivo de retorno (G4)

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/service/sispag/CasamentoRetornoGrupo.ts:34-62`
- **Evidência**: O JSDoc declara "Medido em HML (G4, 2026-10-20, gar 7): o `fin052` traz UMA linha (o J) por item de borderô, com `filCod/bncCod/flpCod/itsCodSeq` + `borCod`, sem `docCod/titCod`, sem valor pago e sem `borTimCad`." A medição foi 1 arquivo de retorno; o matcher ignora `filCod`/`bncCod`/`flpCod` (lines 40-48) e aceita match com `itsCodSeq` **undefined** em qualquer dos dois lados — o que amortece divergência mas também aceita match frágil se o ERP começar a reusar `borCod` entre lotes vizinhos (hoje mitigado só pelo escopo `listarPorLote`).
- **Impacto técnico**: Se um lote futuro tiver duas execuções com o mesmo `borCod` (ex.: borderô reaproveitadoDe + borderô novo após ESTORNADO no mesmo lote), `find(e => e.borCod === linha.borCod)` devolve o primeiro — pode casar com execução errada.
- **Impacto de negócio**: Um grupo marcado `pago` referente a `borCod` antigo (estornado) enquanto o pagamento real foi do borderô novo (ou vice-versa). Mitigado por `SituacaoBorderoFin010` na próxima reconciliação, mas o status transitório é incorreto.
- **Métrica de baseline**: 1 arquivo de retorno medido para `fin052` com item de borderô (G4, HML).

## 5. Cards Kanban

### [integrability-1] Gravar fixtures HAR reais do borderô do grupo antes do cutover PRD

- **Problema**
  > Os 17+11 testes de contrato do borderô do grupo usam corpos sintetizados a partir dos relatos das sondas HML; o único JSON de wire salvo é o `2026-10-14-fin015-vinculo-codbar.json`, de outra feature. O HML `canonico` 6/6 provou o happy path, mas o teste jest nunca viu o byte-por-byte real da resposta de `fin010 POST`, `fin015/finItemSispag/borderosPendentes/importar`, nem do item de borderô dentro de `finItemSispag/list`.
- **Melhoria Proposta**
  > Capturar o HAR da próxima execução HML `canonico` e salvar 4 JSONs em `src/backend/domain/client/__fixtures__/` (fin010 POST, borderosPendentes/list, borderosPendentes/importar, finItemSispag/list com `itsCodSeq`+`borCod`). Adaptar 1 teste por client para carregar o fixture e passar pelo mesmo `.parse()` do boundary. Tactic Bass: Contract testing.
- **Resultado Esperado**
  > Razão fixtures/método novo passa de 1/12 → 4/12; qualquer drift de shape nos 4 endpoints provados aparece como falha de teste local antes do deploy.
- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Fixtures HAR em `__fixtures__/`: 1 → 4
  - Testes carregando fixture real: 0 → 4
- **Risco de não fazer**: O 1º PRD do grupo falha com `ZodError` por diferença de encoding (ex.: `borCod` como string) que um teste de fixture pegaria.
- **Dependências**: Rodar fase HML `canonico` com captura HAR habilitada.

### [integrability-2] Instrumentar parse-failure de boundary (ZodError no .parse) com contador por endpoint

- **Problema**
  > `.parse(raw)` do boundary dos clients vira `ConexosError` sem log estruturado nem contador agregado — logo não há métrica precoce para detectar drift de shape do ERP. O único `warn` dedicado é o de truncamento de página.
- **Melhoria Proposta**
  > Antes do `throw new ConexosError(...)` nos `catch`, se `cause instanceof ZodError` emitir `logService.warn({ type: LOG_TYPE.INTEGRATION_BOUNDARY_PARSE_FAIL, endpoint, campos: cause.issues.map(i=>i.path) })`. Tactic Bass: Observability of integration failures.
- **Resultado Esperado**
  > Operações consegue graficar "parse failure/dia por `(endpoint)`"; 1º incidente de shape detectado em <1h vs. horas por reclamação.
- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Pontos de parse com log estruturado: 0 → 9 (os 9 `.parse` novos)
  - Dashboards com série temporal: 0 → 1
- **Risco de não fazer**: Deriva silenciosa do contrato Conexos; MTTD alto no 1º shape change.
- **Dependências**: nenhuma.

### [integrability-3] Correr HML V7 e `falha`/`retomada` antes de habilitar PRD do grupo

- **Problema**
  > O código tem caminhos específicos para modalidade 7 (banco emissor ≠ banco do lote), para falha determinística do `importar` e para a retomada por `buscarBorderosNaJanela` — mas o HML só rodou `canonico`. A 1ª execução PRD vai exercitar esses caminhos pela primeira vez no wire real.
- **Melhoria Proposta**
  > Executar os probes HML `v7` (grupo com boleto de banco ≠ banco do lote), `falha` (importar com título já alheio) e `retomada` (derrubar o processo entre `criarBorderoDoGrupo` e `registrarBordero`), capturar HAR, cruzar com os assumidos nos testes mockados e, se divergir, atualizar Zod + testes. Tactic Bass: Contract testing + Versioning strategy.
- **Resultado Esperado**
  > HML provado 4/4 (canonico, falha, retomada, v7); PRD GT1/GT2 medidos; cutover gated.
- **Tactic alvo**: Contract testing
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Fases HML provadas: 1/4 → 4/4
  - PRD measurements executados: 0 → 2 (GT1, GT2)
- **Risco de não fazer**: 1º grupo cross-bank em PRD trava a remessa; perda de janela D-0; necessidade de kill-switch SISPAG_LIVE_WRITE_ENABLED aplicado em pânico.
- **Dependências**: Yuri agendar janela HML; acesso ao Conexos HML da Columbia.

### [integrability-4] Discutir pinning de versão do Conexos (header ou segmento) com o fornecedor

- **Problema**
  > Nenhum endpoint `fin010/fin015` carrega versão; qualquer upgrade silencioso do ERP é absorvido reativamente por Zod. A feature ampliou a superfície de escrita (fin010 criar/baixa, fin015 borderosPendentes, PUT finItemSispag) sem acompanhar uma estratégia de pinning.
- **Melhoria Proposta**
  > Follow-up (não bloqueante): abrir conversa com a Conexos pedindo header `X-Conexos-Api-Version` ou segmento de versão nos endpoints de escrita; se recusarem, documentar explicitamente "contrato observado = versão X.Y do ERP em `YYYY-MM-DD`" em `ontology/integrations/conexos.md`. Tactic Bass: Versioning strategy.
- **Resultado Esperado**
  > Pelo menos a versão observada registrada; shim de versão disponível se o Conexos aceitar.
- **Tactic alvo**: Versioning strategy
- **Severidade**: P3
- **Esforço estimado**: S (documentação) / M (se o fornecedor concordar)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Endpoints com versão registrada: 0% → 100% (em `ontology/integrations/conexos.md`)
- **Risco de não fazer**: Upgrade do ERP causa falha correlacionada; postmortem precisa correr git log para reconstituir o shape antigo.
- **Dependências**: Conversa com fornecedor.

### [integrability-5] Reforçar o match da linha de retorno do grupo com `filCod`/`bncCod`/`flpCod`

- **Problema**
  > `CasamentoRetornoGrupo.casar` casa só por `borCod` + `itsCodSeq` opcional, ignorando `filCod`/`bncCod`/`flpCod` que o retorno traz. Se um lote tiver duas execuções com o mesmo `borCod` (reaproveitadoDe + novo após ESTORNADO), `find` devolve a 1ª.
- **Melhoria Proposta**
  > Mudar o `find` para exigir também `linha.filCod === e.filCod && linha.bncCod === e.bncCod && linha.flpCod === e.flpCod` quando esses campos estiverem presentes na linha (ADR-0077 declara que estão); manter `itsCodSeq` opcional. Tactic Bass: Contract testing / Manage Resource Coupling.
- **Resultado Esperado**
  > Match frágil eliminado; grupo pago no borderô errado = 0.
- **Tactic alvo**: Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - Chaves usadas no matcher: 1 → 4 (`borCod` + `filCod` + `bncCod` + `flpCod`); `itsCodSeq` segue como refinamento
- **Risco de não fazer**: Dentro de 6 meses, se o Conexos reaproveitar `borCod` após ESTORNADO num mesmo lote, grupo pode ser marcado `pago` apontando pro ciclo errado.
- **Dependências**: Confirmar com 1 fixture HAR do fin052 que `filCod/bncCod/flpCod` vêm na linha J (ADR-0077 declara que sim).

## 6. Notas do agente

- Escopo da revisão foi o delta do boleto agrupado; o `ConexosSispagClient.lerValoresAberto` (citado no briefing) **não foi tocado** nesta branch (`git diff origin/main..HEAD -- src/backend/domain/client/ConexosSispagClient.ts` vazio) — logo seus riscos são fora de escopo deste QA aqui.
- Cross-QA: **F-integrability-1** e **F-integrability-3** são também sinais de **Testability** (fixtures de wire ≡ testes de contrato) — alertar o consolidator. **F-integrability-2** é cross com **Fault Tolerance** (parse-failure vira ConexosError sem contador) e **Security** (ZodError no boundary de escrita de pagamento). **F-integrability-5** cruza com **Fault Tolerance** (recuperação após ESTORNADO).
- Métrica de observability por endpoint não é medível localmente (depende de CloudWatch/log pipeline — hoje em Render, inexistente); declarei explicitamente.
- Pontos positivos materiais que elevam a nota: doutrina `postGenericOnce` + sem `RetryExecutor` consistente nas 12 escritas novas; Zod em todos os `.parse` de identidade; `SituacaoBorderoFin010` fail-closed; CasamentoRetornoGrupo escopado por `loteId`.
