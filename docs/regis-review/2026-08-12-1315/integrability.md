---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-12-1315
agent: qa-integrability
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Financeiro (Kavex) | Nova regra fiscal (ADR-0036): garantir `dprLngDescrNf` do item da NDe antes da leg fiscal, o que exige adicionar 4 endpoints da tela `com297` ao `ConexosNdeFiscalClient` (list/get/preDescr/put) | Client Conexos leg fiscal + `RecebimentoNumerarioService` (etapa 3.5) + docs de integração/ADR | Produção Columbia (`filCod=2`), leg fiscal gated (`CONEXOS_WRITE_ENABLED` + `CONEXOS_DRY_RUN`) | Adicionar as 4 rotas como métodos de domínio (sem vazar HTTP genérico), preservar RMW por `passthrough()`, respeitar 1 discriminador de sucesso distinto por etapa, atualizar `ontology/integrations/conexos-nde-fiscal.md` e sinalizar a ACL nova | Delta ≤ 3 arquivos de contrato + 1 serviço + 1 env var; 0 vazamento axios; 100% dos endpoints do delta com Zod no boundary; 0 sobreposição de discriminadores; doc de integração `last_review` bumpado |

Cenário concreto: a homologação da NDe passou a ser recusada quando o cadastro do cliente deriva a descrição da DI e o produto de encargo (`41978`) não tem adição de DI. O conserto entrou como uma etapa nova na cauda fiscal (ADR-0036) que só existe se as 4 rotas novas do `com297/comDocProdutos` estiverem encapsuladas com a mesma disciplina RMW do `com300` — sem esse encapsulamento correto, integrar/trocar de novo (ex.: outro produto de encargo) teria custo linear no serviço.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novos endpoints Conexos encapsulados como método de domínio (não HTTP genérico exposto) | 4/4 (`listItensNde`, `lerItemNde`, `preDescricaoProdutoNf`, `gravarDescricaoItemNde`) | 100% | ✅ | `src/backend/domain/client/ConexosNdeFiscalClient.ts:257-419` |
| Fidelidade URL vs swagger do tenant | 4/4 (path segments idênticos ao `060-com2.json`) | 100% | ✅ | `docs/conexos-api/060-com2.json` × `ConexosNdeFiscalClient.ts:263, 310, 340, 400` |
| Endpoints do delta com Zod no boundary | 3/4 endpoints com schema (`ITEM_NDE_SCHEMA` no list/get/put); `preDescrProdutoNf` sem schema por design (swagger `content: {}`) | 3/4 com schema + 1 best-effort documentado | ✅ | `ConexosNdeFiscalClient.ts:68-77, 280, 315, 355-371` |
| Discriminadores de sucesso DISTINTOS por etapa | 3 (fiscal=`fisVldTipoNfDebito===6`, obs=`fisEspObs` não-vazio, item=`dprLngDescrNf` eco não-vazio) + 1 best-effort (`preDescr` nunca lança) | 1 por etapa | ✅ | `ConexosNdeFiscalClient.ts:145, 202, 405, 345` |
| Formas plausíveis toleradas por `preDescrProdutoNf` (swagger sem shape) | 4 (string crua, `{responseData: string}`, `{responseData: {dprLngDescrNf|descricao|descr}}`, `{...}` topo) + fail-open silencioso | ≥ 3 formas + never-throw | ✅ | `ConexosNdeFiscalClient.ts:355-371` + `ConexosNdeFiscalClient.test.ts:235-257` |
| Vazamento de axios/fetch em serviço ou lambda (delta) | 0 (grep) | 0 | ✅ | `grep -n "axios\|import fetch" src/backend/domain/client/ConexosNdeFiscalClient.ts src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` |
| Uso de `putGenericOnce` (RMW não-retryable) para as duas escritas RMW da cauda fiscal (com300 e com297-item) | 2/2 | 2/2 | ✅ | `ConexosNdeFiscalClient.ts:139, 399` |
| Uso de `runWithRetry` nas 3 leituras idempotentes do com297 (list, get item, poll doc) | 3/3 | 3/3 | ✅ | `ConexosNdeFiscalClient.ts:265, 312, 433` |
| Truncamento pró-ativo no `maxLength 4000` do swagger | Sim (`descricao.slice(0, DESCRICAO_IMPRESSAO_MAX)`) | Sim | ✅ | `ConexosNdeFiscalClient.ts:80, 389` |
| Documentação de integração atualizada no mesmo delta | `ontology/integrations/conexos-nde-fiscal.md` bumpado (`last_review: 2026-08-11`, endpoints/table/ACL adicional) + ADR-0036 escrito | Doc + ADR presentes | ✅ | `git diff main -- ontology/integrations/conexos-nde-fiscal.md`; `ontology/decisions/0036-descricao-item-nde-no-documento.md` |
| Cobertura de teste do client novo (unit fixtures) | 8 testes cobrindo os 4 métodos novos (list normaliza null/vazio, get preserva passthrough, put valida eco, preDescr aceita 4 shapes + never-throw) | ≥ 4 cenários por método stateful | ✅ | `src/backend/domain/client/ConexosNdeFiscalClient.test.ts:127-258` |
| ACL nova (`PUT com297/comDocProdutos`) representada no pré-flight `NumerarioAclChecker` | Não (checker faz substring `com297`, que já casa com `HOMOLOGAR`; grant específico "ALTERAÇÃO DE ITEM em com297" não é distinguível) | Grant específico verificável no preflight | ⚠️ | `src/backend/domain/service/recebimentos/NumerarioAclChecker.ts:19-24` × `ontology/integrations/conexos-nde-fiscal.md:98-99` |
| Nova env var (`NDE_DESCRICAO_ITEM_FALLBACK`) propagada em ambas as branches do provider | Sim (dev + prod) | Ambas | ✅ | `src/backend/domain/libs/environment/EnvironmentProvider.ts:178, 237` |
| Serviços tocando >2 clients diretamente (acoplamento de integração) | `RecebimentoNumerarioService` injeta 6 clients Conexos + 1 cadastro (=7). O delta **não adiciona** cliente novo — só consome 3 métodos novos do `ConexosNdeFiscalClient` já existente | Sinal de watchlist (pré-existente) | ⚠️ | `RecebimentoNumerarioService.ts:246-260` |
| Custo marginal do delta (LOC + arquivos) | +203 LOC no client (net), +43 LOC na interface, +120 LOC no service, +16 LOC no env; 20 arquivos tocados (incluindo docs/tests) | ≤ 500 LOC de client + serviço para 4 novos endpoints e 1 etapa nova de fluxo | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: taxa de 403 do ERP na primeira tentativa de PUT `com297/comDocProdutos` (mede se o pré-flight ACL grosso está causando descoberta tardia da falta de grant). Requer telemetria de produção pós-deploy. Recomendação: contador `nde.descricao_item.put.403_count` no `logService.error` para o primeiro real-run pós-configuração de ACL, com alarme se >0.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `ConexosNdeFiscalClient` expõe apenas verbos de domínio (`listItensNde`, `lerItemNde`, `preDescricaoProdutoNf`, `gravarDescricaoItemNde`) — nenhum vazamento HTTP genérico. Os primitivos `putGenericOnce`/`getGeneric` vivem em `ConexosBaseClient` e são consumidos por composição, não expostos ao service | ✅ | `ConexosNdeFiscalClient.ts:257-419` |
| Use an Intermediary | Etapa 3.5 no service (`etapaDescricaoItem`) é o coordenador anti-corrupção sobre a nova rota — o algoritmo (list → check → get → put) mora no service; o client é dumb-pipe transacional | ✅ | `RecebimentoNumerarioService.ts:1445-1500` |
| Restrict Communication Paths | Todo tráfego do delta passa por `ConexosBaseClient` (via `base.getGeneric/postGeneric/putGenericOnce`) — não há import direto de axios/fetch no client novo nem no service | ✅ | `grep -n "axios\|import fetch" src/backend/domain/client/ConexosNdeFiscalClient.ts src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` (0 matches em código do delta) |
| Adhere to Standards | Convenção Conexos respeitada: `filCod` sempre no header (`Cnx-filCod`) via `{filCod}` do primitivo, nunca na URL; verbos HTTP idênticos ao swagger (`POST /list`, `GET /{chave-composta}`, `PUT` sem id) | ✅ | `ConexosNdeFiscalClient.ts:265-277, 312-314, 398-403` × `docs/conexos-api/060-com2.json` |
| Abstract Common Services | `ConexosBaseClient` centraliza `ensureSid`/`runWithRetry`/`put*Once`/`post*Once` — o client novo herda toda a plumbing sem duplicar. RMW (`GET inteiro → mutar campo → PUT inteiro`, `putGenericOnce` uma tentativa) é o mesmo padrão do `com300` | ✅ | `ConexosNdeFiscalClient.ts:106, 118, 138, 265, 312, 398` |
| Discover Service | SSM/env-provider entrega URLs e credenciais do Conexos; nova rota não muda o host, só o path — descoberta é a mesma. `NDE_DESCRICAO_ITEM_FALLBACK` cadastrada em ambas as branches do `EnvironmentProvider` | ✅ | `EnvironmentProvider.ts:178, 237`; `EnvironmentVars.ts:130-149` |
| Tailor Interface | Projeção normalizada `ItemNdeResumo` (`?: string`, "vazio == undefined") separada da `ItemNde` cru com passthrough (para o RMW) — o caller decide com um `=== undefined` em vez de repetir `null || '' || undefined` | ✅ | `NdeFiscal.ts:56-80`; `ConexosNdeFiscalClient.ts:82-87, 278-291` |
| Configure Behavior | `NDE_DESCRICAO_ITEM_FALLBACK` (env) é o único ponto de configuração; ordem de precedência do `resolverDescricaoItem` é código (env → preDescr → prdDesNome → NDE_GERACAO_DEFAULTS.produtoNome). Trade-off aceitável | ✅ | `RecebimentoNumerarioService.ts:1511-1544`; `EnvironmentVars.ts:133-143` |
| Manage Resources | `putGenericOnce` (uma tentativa) para escritas RMW — evita gravar dois estados divergentes se o eco vier truncado. `runWithRetry` só nos GETs/POST-list idempotentes. Cookie/SID reciclado por `ensureSid` a cada tentativa do retry | ✅ | `ConexosNdeFiscalClient.ts:138, 265, 312, 398, 433` |
| Orchestrate | Ordem `(0) descrição → (a) fiscal → (b) obs → (c) homologa` documentada no serviço e no doc de integração; a etapa nova é inserida no lugar certo do orquestrador linear existente. Idempotência por estado do documento (não por ledger monotônico) | ✅ | `RecebimentoNumerarioService.ts:449-457`; `ontology/integrations/conexos-nde-fiscal.md:42-61` |
| Manage Resource Coupling | Delta NÃO adiciona cliente novo (só métodos no existente) — coupling de integração cresce em 3 chamadas dentro do mesmo `ConexosNdeFiscalClient`; substituir o ERP amanhã continua sendo "trocar 1 client" | ✅ | `RecebimentoNumerarioService.ts:249` (sem nova `@inject`) |
| Contract testing (schema-pinned) | Zod `ITEM_NDE_SCHEMA` com `.passthrough()` + fixtures unit — 8 testes (`ConexosNdeFiscalClient.test.ts:127-258`) cobrindo list/get/put + `preDescr` em 4 shapes. Falta fixture derivada do swagger `ComDocProdutosFisFin` (contrato canônico do tenant) — hoje as fixtures são construídas à mão a partir do HAR | ⚠️ | `ConexosNdeFiscalClient.test.ts`; `docs/conexos-api/060-com2.json` (schema `ComDocProdutosFisFin_ComDocProdutosFis`) |
| Versioning strategy | Rotas não têm `/v{N}` (é o padrão do Conexos). O client fixa o path por screen (`com297`), que é a superfície versionada de fato pelo ERP. Sem breakage silenciosa a esperar | N/A | Convenção do tenant (`docs/conexos-api/060-com2.json` server URL sem `/v1`) |
| Backward-compatibility shims | Etapa é no-op para clientes com cadastro compatível (`item.dprLngDescrNf !== undefined` já preenchido). Execuções paradas em `obs-done` são consertadas na retomada por idempotência de estado — sem migração destrutiva | ✅ | `RecebimentoNumerarioService.ts:1462, 1484` |
| Observability of integration failures | `logService.warn` quando lista vem vazia; `warn` estruturado (`type: BUSINESS_WARN`) na gravação bem-sucedida com `descricaoGravada`/`descricaoEco`; `ConexosError` embrulha 100% das falhas de rota com `endpoint` explícito. Falta métrica dedicada de 403 no PUT novo (o log genérico existe, mas não há contador por-endpoint) | ⚠️ | `RecebimentoNumerarioService.ts:1467-1499`; `ConexosNdeFiscalClient.ts:124, 156, 293, 317, 415` |

## 4. Findings (achados)

### F-integrability-1: Pré-flight ACL não distingue o novo grant "alteração de item em com297" — falha só aparece em runtime

- **Severidade**: P2 (débito técnico defensável — runtime fail-closed protege contra escrita irreversível, mas MTTR sobe)
- **Tactic violada**: Discover Service (o pré-flight é o mecanismo que "descobre" se a conta de serviço está apta ANTES de escrever)
- **Localização**: `src/backend/domain/service/recebimentos/NumerarioAclChecker.ts:19-24` × `ontology/integrations/conexos-nde-fiscal.md:98-99`
- **Evidência (objetiva)**:
  ```ts
  // NumerarioAclChecker.ts:19
  const ACL_REQUERIDAS: readonly string[] = [
      'com300', // UPDATE fiscal
      'com131', // GERAR OBS
      'com297', // HOMOLOGAR / HOMOLOGAR CONTINGENCIA
      'com194', // SELECT validações
  ];
  // ...faltando = ACL_REQUERIDAS.filter((k) => !texto.includes(k.toLowerCase()));
  ```
  A doutrina do delta (`ontology/integrations/conexos-nde-fiscal.md`) diz:
  > **ACL adicional (0):** alteração de item em `com297` (`PUT comDocProdutos`) — sem ela a etapa falha
  > fail-closed com o 403 do ERP, antes de qualquer escrita irreversível.
  Mas a lista `ACL_REQUERIDAS` inclui `com297` como um único token — que já casa por substring com qualquer permissão da tela (inclusive `HOMOLOGAR` sozinho). Um tenant que tenha `HOMOLOGAR` mas não tenha `ALTERAÇÃO DE ITEM` passa no pré-flight e falha depois, dentro do fluxo, na `etapaDescricaoItem`.
- **Impacto técnico**: descoberta tardia da falta de grant — o `preflightCom297` reporta "ok" e a execução real bate em 403 dentro do primeiro `putGenericOnce`. Como o RMW novo é `putGenericOnce` (single attempt) e ocorre ANTES da leg fiscal, o fail-closed protege o dado — mas a experiência é "primeira execução real falha por config" em vez de "pré-flight bloqueia deploy".
- **Impacto de negócio**: em rollout de um cliente novo (ou re-provisionamento de conta de serviço), a NDe que dispara a descoberta fica em `revisao_humana`/`error` e exige suporte L2 até o grant ser adicionado — MTTR estimado em horas, não em minutos.
- **Métrica de baseline**: 0 checks discriminados por ação em `NumerarioAclChecker`; 1 novo endpoint de escrita (`PUT com297/comDocProdutos`) não coberto por grant específico.

### F-integrability-2: `preDescrProdutoNf` sem contrato — tolerância defensiva funciona hoje, mas é frágil a mudanças silenciosas do ERP

- **Severidade**: P3 (melhoria opcional — a intenção "best-effort" está correta e testada; o custo é assumido conscientemente)
- **Tactic violada**: Contract testing (schema-pinned) — parcial
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:332-371`
- **Evidência (objetiva)**:
  ```ts
  // 355 — extrairDescricaoSugerida aceita: string crua | {responseData: string}
  //       | {responseData: {dprLngDescrNf|descricao|descr}} | top-level {dprLngDescrNf|descricao|descr}
  private extrairDescricaoSugerida = (raw: unknown): string | undefined => {
      const direto = textoOuIndefinido(raw);
      if (direto !== undefined) return direto;
      // ...
      return textoOuIndefinido(alvo.dprLngDescrNf) ?? textoOuIndefinido(alvo.descricao) ?? textoOuIndefinido(alvo.descr);
  };
  ```
  O swagger declara `responses.200.content: {}` (verificado em `docs/conexos-api/060-com2.json`, path `/api/com297/comDocProdutos/preDescrProdutoNf/...`). O client tenta 4 formas plausíveis e devolve `undefined` em qualquer outra, sem log. O caller cai no próximo fallback (`prdDesNome` → `NDE_GERACAO_DEFAULTS.produtoNome`) — comportamento **correto por design** (é uma sugestão, não uma dependência crítica).
- **Impacto técnico**: se o ERP amanhã devolver, digamos, `{data: 'texto'}` ou `{descricaoImpressao: 'texto'}`, a sugestão silenciosamente vira `undefined`, e o texto usado na NF-e passa a ser sempre o do `prdDesNome` (workaround manual) — indistinguível de "o ERP não calculou nada". Sem log/métrica, o time descobre isso quando o fiscal reclamar do texto.
- **Impacto de negócio**: risco baixo, mas real; a sugestão do ERP é a fonte "certa" no sentido de aplicar a regra do cadastro do cliente quando ela produz algo. Perdê-la silenciosamente degrada a qualidade da descrição impressa sem sinal.
- **Métrica de baseline**: 0 logs quando `preDescrProdutoNf` devolve resposta não-textual/não-mapeada; 4 formas aceitas hoje / N desconhecido.

### F-integrability-3: Contratos do client validados por fixture manual (do HAR), não pelo schema `ComDocProdutosFisFin` do swagger do tenant

- **Severidade**: P3 (melhoria — funciona hoje; a garantia é pela `.passthrough()` que preserva campos que o teste nem enxerga)
- **Tactic violada**: Contract testing (consumer-driven / schema-pinned)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.test.ts:127-258` × `docs/conexos-api/060-com2.json` (schema `ComDocProdutosFisFin_ComDocProdutosFis`, ~105 campos)
- **Evidência (objetiva)**:
  ```ts
  // ConexosNdeFiscalClient.test.ts:128 — fixture construída à mão, 5 campos
  const itemBase = {
      docCod: 18347, fisCod: 1, prdCod: 41978, dprCodSeq: 1,
      prdDesNome: 'PAGAMENTO ANTECIPADO', dprLngDescrNf: null, dprPreValorun: 15000,
  };
  ```
  O contrato canônico do tenant tem ~105 propriedades declaradas em `ComDocProdutosFisFin_ComDocProdutosFis` (swagger). O `.passthrough()` do Zod cobre o RMW no runtime, mas os testes NÃO exercitam nenhuma resposta cujo formato venha do schema oficial — se o swagger mudar (campo renomeado, tipo mudado de int→string), o teste passa e o `putGenericOnce` reenvia o objeto potencialmente inválido, cujo eco o Zod pode reprovar em `parse()`.
- **Impacto técnico**: cobertura de "o cliente sabe fazer o RMW deste shape" depende de um HAR estático de 2026-08-01 (documento 18337). Regressão contratual (Conexos evolui) é detectável só em produção.
- **Impacto de negócio**: baixo hoje (Conexos é estável); custo evitável de 1-2h de bug em uma futura atualização do ERP.
- **Métrica de baseline**: 0 fixtures derivadas de `docs/conexos-api/*.json`; 1 fixture manual (`itemBase`) para o `comDocProdutos`; ~105 campos declarados no swagger vs 7 no teste.

## 5. Cards Kanban

### [integrability-1] Distinguir "alteração de item em com297" no pré-flight ACL

- **Problema**
  > O `NumerarioAclChecker` faz `substring('com297')` — que já casa com `HOMOLOGAR`. O novo `PUT com297/comDocProdutos` exige o grant "ALTERAÇÃO DE ITEM" (documentado como "ACL adicional (0)" em `ontology/integrations/conexos-nde-fiscal.md:98-99`), mas o pré-flight não distingue. Tenant com `HOMOLOGAR` sem `ALTERAÇÃO DE ITEM` passa no pré-flight e falha em runtime, dentro do primeiro real-run.

- **Melhoria Proposta**
  > Ampliar `ACL_REQUERIDAS` (`NumerarioAclChecker.ts:19-24`) para uma lista de `{ tela, acaoLabel }` (ex.: `{ tela: 'com297', acaoLabel: 'alteração de item' }`) e casar por substring do PAR — não só da tela. Enquanto o shape do `permissoes/new/com297` não estiver confirmado por HAR, manter o casamento defensivo por rótulo (case-insensitive) e adicionar `preDescrProdutoNf`/`comDocProdutos` UPDATE ao conjunto. Tactic: **Discover Service** (empurra a descoberta da falta de grant para o pré-flight).

- **Resultado Esperado**
  > Pré-flight bloqueia a execução antes do primeiro `PUT com297/comDocProdutos`; um provisionamento de conta de serviço mal configurado é reportado com `motivo: "missing ACL grants for: com297/alteração de item"`. Métrica: `403 no PUT com297/comDocProdutos em primeiro real-run` de 1+ (esperado no rollout atual) → 0 (bloqueado no pré-flight).

- **Tactic alvo**: Discover Service
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Distinção de grants no `NumerarioAclChecker`: 1 (só tela) → N (tela + ação)
  - Falha de ACL detectada no pré-flight vs runtime: runtime (hoje) → pré-flight
- **Risco de não fazer**: em cada novo tenant onboardado, o primeiro `Recebimento` que dispara a etapa nova consome ciclos de suporte L2 até a ACL ser adicionada; o dado fica no fail-closed correto, mas a integrabilidade percebida do rollout é ruim.
- **Dependências**: idealmente HAR de `GET /api/permissoes/new/com297` para validar o shape antes de ir além do substring — combinar com `ontology/_inbox` já existente.

### [integrability-2] Logar shape inesperado do `preDescrProdutoNf` (sem endurecer o contrato)

- **Problema**
  > `preDescricaoProdutoNf` aceita 4 formas plausíveis e devolve `undefined` para qualquer outra. Comportamento correto (é uma sugestão), mas a degradação silenciosa esconde uma futura mudança de shape do ERP — o caller cai no `prdDesNome` e o fiscal só descobre pelo texto errado na NF-e.

- **Melhoria Proposta**
  > No `extrairDescricaoSugerida` (`ConexosNdeFiscalClient.ts:355-371`), quando `raw` for objeto E nenhuma das chaves mapeadas produzir texto, emitir `logService.warn({type: BUSINESS_WARN, message: 'preDescrProdutoNf devolveu shape não mapeado', data: {keys: Object.keys(raw)}})`. Manter `undefined` como retorno — não endurecer o contrato. Tactic: **Observability of integration failures**.

- **Resultado Esperado**
  > Alteração silenciosa no shape do ERP produz um `warn` estruturado, com o array de chaves top-level, permitindo triagem em 1 log-query. Métrica: cobertura de logs em fallback silencioso: 0/1 caminhos → 1/1.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Logs em fallback silencioso do `preDescr`: 0 → 1
  - Tempo até detecção de "ERP mudou shape do preDescr": indeterminado (hoje: relato do fiscal) → 1 log-query
- **Risco de não fazer**: baixo em janela curta; em 6-12 meses uma versão nova do Conexos pode mudar o envelope e degradar a qualidade da descrição impressa sem sinal.
- **Dependências**: nenhuma.

### [integrability-3] Gerar fixture de contrato dos endpoints com297/comDocProdutos a partir do swagger do tenant

- **Problema**
  > As fixtures do `ConexosNdeFiscalClient.test.ts` são construídas à mão com 5-7 campos, enquanto o schema `ComDocProdutosFisFin_ComDocProdutosFis` do swagger declara ~105 propriedades. O `.passthrough()` do Zod protege o RMW no runtime, mas nenhum teste exercita o shape real — regressão contratual só aparece em produção.

- **Melhoria Proposta**
  > Adicionar um utilitário `docs/conexos-api/fixtures.ts` (dev-only) que hydratar uma instância "shape-realista" de `ComDocProdutosFisFin_ComDocProdutosFis` a partir do JSON do swagger, e usar essa fixture no teste do `lerItemNde`/`gravarDescricaoItemNde` para provar que `.passthrough()` preserva o objeto inteiro e que o Zod aceita o shape declarado. Não substitui HAR; complementa. Tactic: **Contract testing (schema-pinned)**.

- **Resultado Esperado**
  > Alteração do swagger que mude o tipo ou remova um campo esperado quebra pelo menos um teste local (`parse()` do Zod ou o assert de `passthrough`), antes de chegar em produção. Métrica: fixtures shape-derivadas do swagger para `com297/comDocProdutos`: 0 → 1.

- **Tactic alvo**: Contract testing (schema-pinned)
- **Severidade**: P3
- **Esforço estimado**: M (2-5d — genérico e reutilizável para as próximas rotas Conexos)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Fixtures derivadas do swagger: 0 → 1 (com297/comDocProdutos)
  - Cobertura de campos do schema declarado: 7/~105 → ≥ 50/~105 (via hydration)
- **Risco de não fazer**: baixo enquanto o Conexos permanecer estável; alto na primeira upgrade de versão do ERP se o swagger evoluir sem changelog claro.
- **Dependências**: nenhuma; pode ser feito em qualquer `/feature-tweak` que toque outro endpoint do com297.

## 6. Notas do agente

- Escopo restrito ao delta da branch `fix/nde-descricao-item`; métricas de superfície global (nº total de clients, ratio de call sites, etc.) não recalculadas — remetidas ao review completo próximo `--full`.
- Delta é exemplar em Encapsulate/Restrict Communication Paths/Manage Resource Coupling: 4 novos endpoints ERP incorporados sem adicionar cliente novo, sem vazar HTTP, com discriminador de sucesso próprio por etapa e RMW `putGenericOnce` respeitado.
- Cross-QA: **F-integrability-1** (ACL preflight coarse) é insumo direto para **Fault Tolerance** (fail-safe posture completa) e **Security** (ACL enforcement discriminado por ação). **F-integrability-2** (preDescr silencioso) toca **Fault Tolerance** (best-effort semantics documentada, mas invisível no radar). A qualidade do encapsulamento do delta é insumo positivo para **Modifiability** (substituir Conexos amanhã continua sendo "trocar 1 client").
- Não medível localmente: taxa real de 403 no primeiro real-run pós-deploy — depende de CloudWatch/telemetria de produção.
