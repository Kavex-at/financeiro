---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-integrability
generated_at: 2026-08-03T15:52:55-03:00
scope: backend+frontend
score: 7
findings_count: 6
cards_count: 6
---

# Integrability — Regis-Review (ADR-0027 delta)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista no modal "Alocar" da Frente IV | Precisa **reutilizar uma SN já existente** do processo antes de "Processar" (evitar duplicata) | `ConexosGerDocProcessoClient.listSNsByProcesso` + rota `GET /processos/:priCod/sns` + `AlocarProcessosDialog.fetchSNsDoProcesso` | Produção Columbia, ERP Conexos com299 é fonte da verdade; SN pode já existir com título e saldo | O client lê `com299/list` (com filtro `docVldTipo=9`+`docVldTipoAdto=1`+`vldStatus∈{1,3}`+`priCod`), valida no boundary Zod (`.passthrough`), guarda defensivamente NC/ND (`docVldTipoAdto=0`), projeta ao DTO; a rota adiciona authz por-filial; o FE lista, deixa o analista escolher e ecoa `snDocCod` no POST | Nova integração adicionada em **1 método público** (`listSNsByProcesso`, 68 linhas), **1 rota READ** (`GET /processos/:priCod/sns`, 38 linhas), **1 helper FE** (`fetchSNsDoProcesso`, 14 linhas) e **1 campo opcional** (`snDocCod ↔ snSelecionadaDocCod`) atravessando a stack sem novo client, novo repositório, nova entidade. Nenhum axios/fetch fora dos boundaries; constants reusadas (9/1 nunca hardcoded no site novo); erro padronizado em `ConexosError`. FE/BE contract 1:1, tipos espelhados. |

Cenário concreto: um crédito de R$15.000 do SKYJACK cai; o analista abre "Alocar", escolhe o processo 3254 — o painel direito faz `GET /recebimentos/processos/3254/sns?filCod=4`, que dispara `POST /api/com299` (via `listGenericPaginated`) e devolve a SN nº 731 finalizada; o analista seleciona; "Processar" envia `snDocCod=18342` e o serviço PULA `com299/gerDocProcesso` + `completarSnAdiantamento` + `finalizaDocumento`, indo direto para `fin014` + `com297` contra ele — sem duplicar documento no ERP (invariante I-Receb-3).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos tocados pelo delta ADR-0027 | 9 (2 BE client, 2 BE service, 2 BE routes, 3 FE) | ≤ 15 para uma superfície de LEITURA + 1 branch de settle | ✅ | `_shared-metrics.md` |
| Novos métodos públicos no client Conexos | 1 (`listSNsByProcesso`) | 1 (READ isolado) | ✅ | `ConexosGerDocProcessoClient.ts:1049` |
| Métodos genéricos HTTP vazando do client | 0 (só nomes de domínio: `listSNsByProcesso`) | 0 | ✅ | grep `listSNsByProcesso` em `ConexosGerDocProcessoClient.ts` |
| axios/fetch em service/repo/rota da mudança | 0 (só o helper `apiFetch` no FE, wrapper) | 0 fora do boundary | ✅ | grep manual em `RecebimentoNumerarioService.ts`, `recebimentos.ts`, `recebimentos.ts` (FE) |
| Zod no boundary do client novo | `SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA` + `SOLICITACAO_NUMERARIO_ROW_SCHEMA` (`.passthrough()`, coerce, nullish→undefined) | Zod obrigatório em resposta Conexos | ✅ | `SolicitacaoNumerarioListItem.ts:17-73` |
| Reuso das constantes de discriminador (9/1) | 2 usos (filtro + guard) via `SOLICITACAO_NUMERARIO_DOC_VLD_TIPO`/`_ADTO` | 0 hardcodes | ✅ | `ConexosGerDocProcessoClient.ts:1088-1089,1109-1110` |
| Constantes redefinidas no FE (drift risk) | 1 (`SolicitacaoNumerarioListItem` interface FE espelha BE manualmente; `docVldTipo/docVldTipoAdto` NÃO cruzam a fronteira, ficam no BE) | Espelho manual documentado | ⚠️ | `src/frontend/lib/recebimentos.ts:435-452` |
| Contract tests do endpoint novo (fixture-based) | 3 casos: shape + guard NC/ND + statusLabel fallback | ≥ 3 (feliz + defensivo + edge) | ✅ | `ConexosGerDocProcessoClient.test.ts:576-687` |
| Contract tests da rota BE | 4 casos (200 OK, 403 cross-filial, 400 sem filCod, 400 priCod inválido) | ≥ 3 | ✅ | `recebimentos.test.ts:268-341` |
| Contract tests do contrato FE↔BE (snDocCod) | 2 casos (envia snDocCod / omite quando novo) + FE dialog test cases | ≥ 2 | ✅ | `recebimentos.test.ts:410-440`, `AlocarProcessosDialog.test.tsx:177-212` |
| `runWithRetry`/`ensureSid` no novo método | ❌ AUSENTE em `listSNsByProcesso` (chamada `listGenericPaginated` DIRETA); presente nos irmãos `listContasProjeto`, `listConfigDocProcesso`, `resolveGcdCodByName` | Simetria com irmãos idempotentes | ❌ | `ConexosGerDocProcessoClient.ts:1058` vs `:510`, `:802`, `:1009` |
| URL do endpoint (path do POST) | `'com299'` — HAR/ADR-0027 diz `com299/list` | `com299/list` conforme HAR | ❌ | `ConexosGerDocProcessoClient.ts:1059` vs ADR-0027 §D1 |
| Paginação da lista de SN | Uma página única, `pageSize=50` (padrão); `count` do envelope descartado | Se >50 SNs, truncamento silencioso; ou paginar/expor teto | ⚠️ | `ConexosGerDocProcessoClient.ts:1055,1092-1093,1099-1102` |
| Idempotência READ | GET puro sem side-effects; sem cache client-side; FE cacheia por `priCod` na sessão do modal | GET stateless idempotente | ✅ | `AlocarProcessosDialog.tsx:305-327` |
| Envelope schema pinning (`.passthrough`) | Passthrough consciente + campos load-bearing tipados | Padrão dos irmãos | ✅ | `SolicitacaoNumerarioListItem.ts:18-70` |
| Erro embrulhado em `ConexosError` (endpoint pinado) | Sim — `endpoint: 'com299/list'` (mesmo com a URL real sendo `com299`) | Padrão dos irmãos | ⚠️ | `ConexosGerDocProcessoClient.ts:1115` |

> ⚠️ **Não medível localmente**: MTTR de um incidente Conexos que degrade especificamente `com299/list` (5xx intermitente) — requer CloudWatch/observability de produção por-endpoint. Recomendação: instrumentar o client com um metric-per-path (já sugerido por Regis-Review anterior, aplicável ao novo endpoint sem código extra se o base ganhar um wrapper de métrica).

## 3. Tactics — Cobertura no nf-projects (delta ADR-0027)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Método público **domain-named** (`listSNsByProcesso`) que esconde `POST /api/com299`, o wrapper `filterList`/`fieldList`/`orderList` e a projeção do wire para o DTO lógico. Nenhum service resolve `ConexosBaseClient` para chamar `listGenericPaginated` direto. | ✅ presente | `ConexosGerDocProcessoClient.ts:1049-1117`; rota consome só o método público (`recebimentos.ts:390-391`) |
| Use an Intermediary | O `ConexosGerDocProcessoClient` é o intermediário canônico da família com068/com299/com297 — a rota depende só dele; o service `RecebimentoNumerarioService` também. O novo método entra na mesma classe (não cria irmão `ConexosSnListClient` só para ler). | ✅ presente | `recebimentos.ts:29,390`; `RecebimentoNumerarioService.ts:202-203` |
| Restrict Communication Paths | A rota chama exclusivamente o client (nenhum `axios`/`fetch` embutido); o service consome o `snSelecionadaDocCod` de um único ponto (`ProcessarAlocacaoInput`), e o branch em `etapaSn` é o único lugar que decide gerar × pular. | ✅ presente | `RecebimentoNumerarioService.ts:117-124, 356-357, 418-462` |
| Adhere to Standards | Segue o padrão da família: Zod `.passthrough()`, ConexosError no catch, projeção `to*ListItem` interna, constantes tipadas para discriminadores. Body do POST usa a mesma forma dos irmãos (`fieldList/filterList/pageNumber/pageSize/serviceName/orderList`). | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1058-1098`; **desvio**: o URL passado a `listGenericPaginated` é `'com299'` (sem `/list`), enquanto os irmãos usam `'com299/list'`/`'fin064/list'` — ver F-integrability-1 |
| Abstract Common Services | Reusa `ConexosBaseClient.listGenericPaginated` (mesma paginação/session/error path) e as constantes `SOLICITACAO_NUMERARIO_DOC_VLD_TIPO`/`_ADTO` já centralizadas em `constants.ts` (nada de 9/1 mágico local). | ✅ presente | `ConexosGerDocProcessoClient.ts:1088-1089, 1109-1110`; `constants.ts:151-153` |
| Discover Service | N/A para este delta — o novo endpoint reusa a base client cuja SSM/URL/Auth já é resolvida por `ConexosSessionResolver`. Nenhum novo SSM param necessário. | N/A | Justificativa: reusa infra existente sem parametrização nova. |
| Tailor Interface | O DTO devolvido é a **projeção lógica** (`docCod/numero/data/descricao/status/statusLabel/solicitado/valor`) — não vaza `docEspNumero`/`docVldTipoAdto`/`vldStatus`/`docDtaEmissao`(epoch); `statusLabel` já normaliza (`vldStatus` cru → "Aberta"/"Finalizada"/fallback `SN 7`); data em ISO. FE recebe o DTO estável. | ✅ presente | `ConexosGerDocProcessoClient.ts:1120-1131`; `SolicitacaoNumerarioListItem.ts:82-113` |
| Configure Behavior | `pageSize` parametrizável (`params.pageSize ?? 50`) mas **sem loop paginado**: se um processo tiver mais de 50 SN o resto some sem sinal. | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1055,1092-1093` — ver F-integrability-3 |
| Manage Resources | Sem novo pool / sem novo recurso — reusa a sessão Conexos (adapter legado) que já gerencia SID/401-retry via `authenticatedPost`. Só faltou empilhar o `runWithRetry` para 5xx/timeout (F-integrability-2). | ⚠️ parcial | `legacyConexosAdapter.ts:37-51` (auth-retry sim), `ConexosBaseClient.ts:221` (retry sim, MAS não invocado no novo método) |
| Orchestrate | `RecebimentoNumerarioService.processarAlocacao` recebeu 1 branch novo (`snSelecionadaDocCod !== undefined`) em `etapaSn` — não introduziu novo passo, novo estado, nem cross-service. É orquestração linear com short-circuit. | ✅ presente | `RecebimentoNumerarioService.ts:418-462` (delta minimalista de 12 linhas de decisão) |
| Manage Resource Coupling | O settle contra SN existente REMOVE 3 chamadas irreversíveis (com299/gerDocProcesso + completarSn + finalizaDocumento) — **DIMINUI** acoplamento no fluxo escolhido (menos escrita → menos ponto de falha). | ✅ presente | ADR-0027 §"Consequências"; `RecebimentoNumerarioService.ts:425-462` |
| Contract testing | Testes de client cobrem o wire (filtro correto, projeção, guard NC/ND, fallback do statusLabel); testes de rota cobrem authz + shape da resposta; testes de service cobrem o branch selecionado ("não gera nem finaliza"); testes FE cobrem `snDocCod` envio/omissão. | ✅ presente | `ConexosGerDocProcessoClient.test.ts:576-687`; `recebimentos.test.ts:268-341,410-440`; `RecebimentoNumerarioService.test.ts:255-263`; `AlocarProcessosDialog.test.tsx:177-212` |
| Versioning strategy | Reusa o URL do ERP Conexos (sem `/vN`). Para o contrato FE↔BE não há versionamento explícito — o campo `snDocCod` é adicionado como opcional (backward-compatible com clientes antigos). | ✅ presente | `recebimentos.ts:420-424` (Zod `.optional()`) — o cliente antigo continua funcionando |
| Backward-compatibility shims | `snDocCod` opcional no schema Zod; o service trata `undefined` como o comportamento anterior ("Criar novo SN"). Nenhuma migration DB, nenhum breaking change no ledger `solicitacao_numerario_execucao`. | ✅ presente | `RecebimentoNumerarioService.ts:117-124,425-462` |
| Observability of integration failures | `ConexosError` embrulha com `endpoint: 'com299/list'` para o log, o que permite filtrar métrica por endpoint. NÃO há counter/histogram por-endpoint hoje (limitação repo-wide, não deste delta). | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1115` — mensagem estruturada sim, métrica dedicada não |

## 4. Findings

### F-integrability-1: URL do novo endpoint diverge do HAR/ADR-0027 (`com299` vs `com299/list`)

- **Severidade**: P0
- **Tactic violada**: Adhere to Standards (e Contract testing — o teste espelha o bug)
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1056-1116`, teste em `src/backend/domain/client/ConexosGerDocProcessoClient.test.ts:604`
- **Evidência (objetiva)**:
  ```typescript
  // client:1056-1059
  const path = 'com299/list';           // usado só na mensagem de erro
  try {
      const page = await this.base.listGenericPaginated<Record<string, unknown>>(
          'com299',                      // ← URL REAL enviada ao ERP (não 'com299/list')
          { … filterList: { 'priCod#EQ': priCod, … }, serviceName: 'com299', … },
          { filCod },
      );
  ```
  ```typescript
  // teste:604
  expect(listGenericPaginated.mock.calls[0][0]).toBe('com299')  // congelou o bug
  ```
  Comparar com o irmão `resolveGcdCodByName` (linha 1011-1012) e com `ConexosSispagClient.ts:187` (`'fin064/list'`) — ambos usam `<tela>/list` como URL. O ADR-0027 §D1 diz literalmente `POST /api/com299/list`.
- **Impacto técnico**: O `authenticatedPost('/com299', body)` cai em rota diferente da HAR-confirmada. Em produção, dois desfechos possíveis (a definir por probe): (i) o ERP responde 404/405 e a lista sempre falha — "Não foi possível carregar as SN" no analista; (ii) o ERP responde algo diferente (list "root" do serviço), a resposta pode não trazer `count/rows` no shape esperado e o Zod devolve `rows: []` — lista sempre VAZIA, silenciosamente. Em qualquer cenário, o analista NUNCA vê uma SN existente e sempre cai no "Criar novo SN" — que é exatamente o comportamento que o ADR-0027 veio consertar (I-Receb-3 "não cria segundo documento").
- **Impacto de negócio**: A feature ADR-0027 fica inerte em produção; duplicação de SN volta a ser possível pela via "não achei nada, criei uma nova" — invariante I-Receb-3 quebrado por defeito de path, não por lógica. Correção mínima (1 caractere) mas com risco de retrabalho se não pego antes do primeiro release.
- **Métrica de baseline**: Cobertura de fixture do path real = 0/1 (o teste unitário congela o path errado; nenhum teste bate contra a URL prescrita `com299/list`).

### F-integrability-2: `listSNsByProcesso` não empilha `runWithRetry`/`ensureSid` (assimetria com os irmãos)

- **Severidade**: P1
- **Tactic violada**: Manage Resources, Adhere to Standards
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1049-1117`
- **Evidência (objetiva)**:
  ```typescript
  // Novo método: chamada DIRETA (sem retry executor, sem ensureSid explícito)
  const page = await this.base.listGenericPaginated<Record<string, unknown>>('com299', body, { filCod });
  // Comentário do próprio código: "listGenericPaginated (já embrulha retry + ensureSid)" — parcialmente falso.
  ```
  Comparar com os irmãos idênticos em intenção (LOV/lista paginada READ):
  - `listContasProjeto` (linha 510): `return await this.base.runWithRetry(async () => { await this.base.ensureSid(); const page = await this.base.listGenericPaginated(...); ... });`
  - `resolveGcdCodByName` (linha 1009): mesmo padrão.
  - `listConfigDocProcesso` (linha 802): mesmo padrão.
  O `authenticatedPost` do `legacyConexosAdapter` faz **401-retry** (auth refresh), mas o `RetryExecutor` do base (2 retries / 500ms / jitter 200ms) só é aplicado quando o caller o envolve — o que os três irmãos fazem e este não faz.
- **Impacto técnico**: um único blip de 5xx/timeout do Conexos no `com299/list` derruba a chamada — sem retry — e o analista vê "Falha ao carregar as SN" onde os irmãos silenciosamente tolerariam o mesmo blip. Também há divergência semântica no `ensureSid`: `authenticatedPost` chama `ensureSid` internamente em cada request, mas os irmãos incluem um `await this.base.ensureSid()` PRÉ-chamada — se um `runWithRetry` for adicionado depois (F-integrability-2 remediado), a paridade fica consistente.
- **Impacto de negócio**: micro-flakes da rede ou do ERP degradam a UX do modal Alocar sem valor de negócio (a lista READ é idempotente — tem que retryar). Não bloqueante — mas notável, porque este é o ponto mais visível para o analista no dia-a-dia do ADR-0027.
- **Métrica de baseline**: 0 de 4 métodos de LOV do próprio client seguem esse padrão (3 wrap, 1 não).

### F-integrability-3: Paginação truncada — apenas 1 página de 50 e `count` descartado

- **Severidade**: P2
- **Tactic violada**: Configure Behavior, Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1055,1092-1102`
- **Evidência (objetiva)**:
  ```typescript
  const pageSize = params.pageSize ?? 50;
  // ...
  pageNumber: 1,      // NUNCA busca a página 2
  pageSize,
  // ...
  const envelope = SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA.parse({
      ...page,
      rows: page.rows ?? [],
  });
  // envelope.count é PARSEADO mas NUNCA usado (nem devolvido, nem loga aviso)
  return envelope.rows.filter(...).map(...);
  ```
  Compare com `listCondPgtoPessoa` (linha 843-879) que descobriu o exato mesmo modo de falha em execução real ("HML 2026-08-03, pesCod 232: pedimos pageSize 500, ERP devolveu 50") e agora ITERA pelo `count`. O comentário desse método é uma advertência textual — e ainda assim o novo método repete o padrão que foi consertado.
- **Impacto técnico**: um processo com mais de 50 SN (edge, mas possível em processos longos ou em tenants com histórico) perde as mais antigas silenciosamente. Como a ordem é `docCod desc` (mais recentes primeiro), o cenário provável de perda é "SN antiga aberta que ainda precisa receber baixa fica invisível" — o analista cria uma nova e viola I-Receb-3.
- **Impacto de negócio**: mesmo efeito de F-integrability-1 mas no long-tail (processos com > 50 SN); menos comum em greenfield, mais comum em backfill/histórico. Não bloqueante para o release; virará dívida real quando um cliente com processo de longa duração aparecer.
- **Métrica de baseline**: teto atual = 50 SN por processo (silencioso); `count` do envelope descartado (perda de sinal).

### F-integrability-4: Client mente na mensagem de erro (`endpoint: 'com299/list'` quando a chamada real é `'com299'`)

- **Severidade**: P2 (agravante de F-integrability-1 — se F-1 for corrigido, este some por acidente)
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1056,1115`
- **Evidência (objetiva)**:
  ```typescript
  const path = 'com299/list';        // string local
  try {
      const page = await this.base.listGenericPaginated<...>('com299', ...);  // URL real
      // ...
  } catch (cause) {
      throw new ConexosError({ endpoint: path, cause });  // reporta 'com299/list', mentira
  }
  ```
- **Impacto técnico**: quando F-1 gera uma falha em produção, o log/alarme dirá "falhou `com299/list`", exatamente o URL que NÃO foi chamado — dificultando o diagnóstico do bug de F-1. Observability envenenada por drift entre `path` variável de erro e URL efetiva.
- **Impacto de negócio**: MTTR do incidente F-1 aumenta (o engenheiro vai investigar por que `com299/list` falha, procurar o path no HAR, e demorar a perceber que a chamada real está indo em outro lugar).
- **Métrica de baseline**: 1 de 1 caminhos de erro do método reporta URL divergente da real.

### F-integrability-5: `count` do envelope perdido — FE não sabe quantas SN existem no processo

- **Severidade**: P3
- **Tactic violada**: Tailor Interface
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1099-1113`, `src/backend/routes/recebimentos.ts:391`, `src/frontend/lib/recebimentos.ts:526-539`
- **Evidência (objetiva)**:
  ```typescript
  // schema BE: envelope.count existe (SolicitacaoNumerarioListItem.ts:57-61)
  // client: DESCARTA count (só devolve envelope.rows.filter...)
  // rota: res.json({ priCod: priCod.data, sns })  ← sem { total, truncated }
  // FE: `SolicitacaoNumerarioListItem[]` — array puro
  ```
- **Impacto técnico**: o FE não pode sinalizar ao analista "existem 137 SN neste processo, mostrando 50" (nem "há mais uma página"). Combinado com F-3, o silêncio é duplo: BE trunca em 50, FE não avisa.
- **Impacto de negócio**: cauda longa (processo com muitas SN) — silêncio na UI ao invés de "mostrando 50 de N".
- **Métrica de baseline**: 0 sinais de truncamento expostos ao FE (`total`, `truncated`, `pageNumber` não trafegam).

### F-integrability-6: Interface `SolicitacaoNumerarioListItem` duplicada FE↔BE (drift latente)

- **Severidade**: P3
- **Tactic violada**: Adhere to Standards (drift entre boundaries)
- **Localização**: `src/backend/domain/interface/recebimentos/SolicitacaoNumerarioListItem.ts:96-113` vs `src/frontend/lib/recebimentos.ts:435-452`
- **Evidência (objetiva)**: os campos `{ docCod, numero, data, descricao, status, statusLabel, solicitado, valor }` são declarados duas vezes com comentários paralelos ("`docCod` da SN — o handle que a baixa fin014 + NDe com297 usam") — se o BE mudar (adicionar `saldo`, renomear `descricao`), o FE compila em silêncio até que um consumidor real quebre em runtime.
- **Impacto técnico**: qualquer evolução do DTO exige tocar dois arquivos em compasso; sem contract test cross-boundary, a divergência não é detectada automaticamente.
- **Impacto de negócio**: dívida técnica limitada; agravada quando outras superfícies novas seguirem o mesmo padrão sem um contrato compartilhado (OpenAPI/JSON Schema).
- **Métrica de baseline**: 1 DTO duplicado no delta; 0 contratos machine-readable compartilhados.

## 5. Cards Kanban

### [integrability-1] Corrigir URL de `listSNsByProcesso` para `com299/list` + fixar teste com o path do HAR

- **Problema**
  > O novo método POSTa em `/api/com299`, mas o HAR/ADR-0027 prescreve `POST /api/com299/list`. O teste unitário `expect(...).toBe('com299')` congelou o bug. Em produção a lista é falha silenciosa (`rows: []`) ou 404/405 — nunca traz a SN existente, tornando a feature inerte e recolocando o risco de duplicação de SN (violação de I-Receb-3).

- **Melhoria Proposta**
  > Trocar `listGenericPaginated<...>('com299', ...)` por `listGenericPaginated<...>('com299/list', ...)` em `ConexosGerDocProcessoClient.ts:1059` — alinhando com o irmão `resolveGcdCodByName` (`${tela}/list`). Atualizar `ConexosGerDocProcessoClient.test.ts:604` para `expect(...).toBe('com299/list')`. Se possível, adicionar um fixture-based test que use um envelope real (HAR-confirmed) para blindar o parsing. Tactic Bass: **Adhere to Standards**.

- **Resultado Esperado**
  > `listSNsByProcesso` bate na rota HAR-confirmada em produção; SNs existentes voltam com dados; ADR-0027 D1/D2/I-Receb-3 passam a valer. Métrica: taxa de "0 SN encontradas quando o ERP tem" cai de ~100% para ~0%.

- **Tactic alvo**: Adhere to Standards + Contract testing
- **Severidade**: P0
- **Esforço estimado**: S (≤1d) — mudança pontual em 2 arquivos + smoke test contra HML
- **Findings relacionados**: F-integrability-1, F-integrability-4
- **Métricas de sucesso**:
  - URL POST em `listSNsByProcesso`: `com299` → `com299/list`
  - `count` do envelope em resposta HML: 0 (bug) → >0 quando existirem SNs
- **Risco de não fazer**: feature ADR-0027 nasce morta; duplicação de SN volta em produção; a próxima frente a integrar com299 vai copiar o padrão errado.
- **Dependências**: nenhuma; recomendável validar em HML com HAR antes do PR.

### [integrability-2] Envolver `listSNsByProcesso` em `runWithRetry` + `ensureSid` (paridade com os irmãos)

- **Problema**
  > Ao contrário de `listContasProjeto`, `listConfigDocProcesso` e `resolveGcdCodByName` (todos LOV/READ paginados), `listSNsByProcesso` chama `listGenericPaginated` sem `runWithRetry` nem `ensureSid` explícito. Micro-blip de rede/5xx → falha imediata na UI do analista. O comentário do próprio método afirma (incorretamente) que "`listGenericPaginated` já embrulha retry + ensureSid".

- **Melhoria Proposta**
  > Envolver a chamada no mesmo padrão dos irmãos:
  > ```ts
  > return await this.base.runWithRetry(async () => {
  >     await this.base.ensureSid();
  >     const page = await this.base.listGenericPaginated<...>(...);
  >     // ...parse + filter + map
  > });
  > ```
  > Corrigir o comentário. Tactic Bass: **Manage Resources / Adhere to Standards**.

- **Resultado Esperado**
  > Simetria com irmãos; um único blip do Conexos deixa de degradar a UX do modal Alocar. Métrica: taxa de falha por blip transiente cai de ~1 tentativa para ~3 tentativas antes de surfacear ao FE.

- **Tactic alvo**: Manage Resources
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Métodos LOV/lista do client com `runWithRetry`: 3/4 → 4/4
  - Comentário do código reflete a realidade
- **Risco de não fazer**: micro-flakes viram tickets fantasma "às vezes a lista de SN não abre" — muito caros de reproduzir e diagnosticar.
- **Dependências**: nenhuma; pode ir junto com o card 1.

### [integrability-3] Paginar `listSNsByProcesso` pelo `count` do envelope (nunca truncar em silêncio)

- **Problema**
  > O método pede `pageSize=50` e busca só `pageNumber:1`. O envelope tem `count`, mas ele é descartado. Um processo com >50 SN perde as antigas — invisíveis para o analista. Combina mal com F-integrability-1: mesmo depois de corrigir a URL, o teto continua em 50. O irmão `listCondPgtoPessoa` documenta esse exato modo de falha ("HML 2026-08-03, ERP ignora pageSize").

- **Melhoria Proposta**
  > Reusar a mesma doutrina de `listCondPgtoPessoa` (loop while `acumulado < count` OU página vazia, teto de segurança em N páginas). Alternativa mais simples: subir o `pageSize` para 500 (paridade com `resolveGcdCodByName`) e exigir 1 página só como caso normal; se `count > pageSize`, logar `BUSINESS_WARN` e retornar o que tem + `truncated: true` no DTO. Tactic Bass: **Configure Behavior**.

- **Resultado Esperado**
  > Teto real vira ~500 (ou N × 500 no loop); `count` deixa de ser um dado descartado; qualquer truncamento vira log auditável.

- **Tactic alvo**: Configure Behavior
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3, F-integrability-5
- **Métricas de sucesso**:
  - Teto de SN por processo: 50 → 500 (ou ∞ via loop, com cap-hit auditável)
  - `count` do envelope: descartado → usado
- **Risco de não fazer**: em 6 meses, processo com > 50 SN aparece em produção (backfill/tenant antigo) e a analista recria SN silenciosamente, quebrando I-Receb-3.
- **Dependências**: card 1 (o URL correto tem que estar em pé antes de exercitar loops).

### [integrability-4] Manter `endpoint` do `ConexosError` sincronizado com a URL real

- **Problema**
  > `throw new ConexosError({ endpoint: 'com299/list', cause })` reporta um path que NÃO é o chamado (`'com299'`). Log/alarme aponta para o lugar errado no dia de incidente.

- **Melhoria Proposta**
  > Ou definir `const path = 'com299/list'` UMA vez e reusá-lo tanto na chamada (`listGenericPaginated(path, ...)`) quanto no `ConexosError({ endpoint: path, ... })` — resolve F-4 e F-1 juntos. Padrão dos irmãos. Tactic Bass: **Observability of integration failures**.

- **Resultado Esperado**
  > Log de falha aponta para o URL efetivamente chamado; diagnóstico direto.

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P2 (colapsa com card 1)
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - `endpoint` do `ConexosError`: divergente → consistente com URL POST
- **Risco de não fazer**: MTTR do próximo incidente com299 fica maior; padrão errado propaga.
- **Dependências**: card 1 (implementar junto).

### [integrability-5] Expor `total`/`truncated` no DTO do endpoint `GET /processos/:priCod/sns`

- **Problema**
  > A resposta atual é `{ priCod, sns }` — o FE não sabe se a lista está completa. Combinado com o teto de 50 (F-3), o silêncio é duplo. O envelope Conexos já traz `count`.

- **Melhoria Proposta**
  > Devolver `{ priCod, sns, total, truncated }` (onde `total = count` do envelope e `truncated = sns.length < total`). No FE, quando `truncated`, exibir um discreto "Mostrando as N mais recentes de M — refine o filtro" no painel direito. Tactic Bass: **Tailor Interface**.

- **Resultado Esperado**
  > FE sinaliza truncamento em vez de esconder; analista sabe quando precisa buscar diferente.

- **Tactic alvo**: Tailor Interface
- **Severidade**: P3
- **Esforço estimado**: S (1d)
- **Findings relacionados**: F-integrability-3, F-integrability-5
- **Métricas de sucesso**:
  - Sinal de truncamento no FE: 0 → 1
  - Cards com > 50 SN: silêncio → aviso visível
- **Risco de não fazer**: baixo em greenfield; agrava com backfill.
- **Dependências**: card 3 (o mesmo caminho de código).

### [integrability-6] Compartilhar o DTO `SolicitacaoNumerarioListItem` entre FE e BE (ou gerar do schema)

- **Problema**
  > `interface SolicitacaoNumerarioListItem` está declarada em `src/backend/domain/interface/recebimentos/SolicitacaoNumerarioListItem.ts:96-113` e reesceita em `src/frontend/lib/recebimentos.ts:435-452` com os MESMOS campos e comentários. Adicionar/renomear um campo exige tocar dois lados em compasso; um miss compila silenciosamente até quebrar em runtime.

- **Melhoria Proposta**
  > Ou: (a) publicar os schemas Zod do BE como fonte única (build-time) e derivar os tipos no FE via `z.infer`; (b) manter a duplicação mas adicionar um teste "contract mirror" que importa AMBOS os arquivos e falha se os campos divergirem (via `keyof` compare); (c) no médio prazo (Frente XI), formalizar OpenAPI/tRPC. Este delta pode aceitar (b) como amortização barata. Tactic Bass: **Adhere to Standards**.

- **Resultado Esperado**
  > Drift FE↔BE detectado no CI, não em produção.

- **Tactic alvo**: Adhere to Standards / Contract testing
- **Severidade**: P3
- **Esforço estimado**: M (2-5d) para (a); S (≤1d) para (b)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - DTOs BE↔FE cobertos por assertion cross-boundary: 0 → 1 (deste delta)
  - Latência do drift (build → runtime): infinita → CI
- **Risco de não fazer**: cada novo DTO da Frente IV duplica; drift eventual em produção.
- **Dependências**: nenhuma; recomendável fazer em conjunto com o card [modifiability-*] equivalente do consolidator.

## 6. Notas do agente

- Escopo restrito ao delta ADR-0027 (`listSNsByProcesso`, rota SNs, `snDocCod ↔ snSelecionadaDocCod`) — não auditei outros clients Conexos, o pipeline SISPAG, nem a leg fiscal.
- **Cross-QA (para o consolidator)**: F-integrability-1 é primariamente Integrability (contrato ERP quebrado) mas tem overlap forte com **Fault Tolerance** (silêncio ao invés de fail-loud) e **Correctness/Security** (I-Receb-3 é um invariante de dinheiro — "não duplicar documento"). F-integrability-2 tem overlap com **Availability** (retry envenenado por micro-blip). F-integrability-6 tem overlap com **Modifiability**.
- Métrica que tentei medir e falhou: taxa real de 5xx no `com299/list` — requer CloudWatch/produção. Só medível localmente após instrumentar per-endpoint no `ConexosBaseClient`.
- Observabilidade estruturada existente (`ConexosError.endpoint`) é bom pé para futuras métricas — este delta piorou o sinal (F-4).
- Recomendação forte ao consolidator: **card 1 é P0** — é o único achado que impede a feature de funcionar como especificada. Cards 2-6 são melhorias defensáveis mas não bloqueantes.
