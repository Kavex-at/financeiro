---
qa: Availability
qa_slug: availability
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-availability
generated_at: 2026-08-03T18:47:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Escopo: feature ADR-0027 — “selecionar SN existente antes de Processar” no modal Alocar (Frente IV — Recebimentos).
Superfície nova: (a) leitura `ConexosGerDocProcessoClient.listSNsByProcesso` → `POST /com299` no Conexos; (b) rota `GET /recebimentos/processos/:priCod/sns`; (c) rama write “SN existente” em `RecebimentoNumerarioService.etapaSn` (pula geração/finalização); (d) modal `AlocarProcessosDialog` + `lib/recebimentos.fetchSNsDoProcesso`.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP (`com299/list`) intermitente ou lento | Analista abre painel direito do modal para escolher uma SN de um processo | `ConexosGerDocProcessoClient.listSNsByProcesso` → `ConexosBaseClient.listGenericPaginated` → adapter → `authenticatedPost` | Produção, analista financeiro no meio de fechamento diário | Reter latência local via retry idempotente + timeout curto; devolver ao FE um erro classificado (`ConexosError`) que o toast entende — nunca uma tela travada nem uma lista silenciosamente vazia | 0% de falsos “sem SN existente” (blank list) causados por transporte; MTTR do analista ≤ 30 s (retry automático absorve blip; erro real vira aviso claro que ele pode reagir clicando “Criar novo SN”) |
| Analista escolhe uma SN cujo `docCod` não pertence ao processo (lista stale, digitação, cache do BE) | POST `/recebimentos/transacoes/:txnId/solicitacao-numerario` com `snDocCod` inválido | `RecebimentoNumerarioService.etapaSn` (rama SN existente) | Execução real com escrita habilitada | Falha-fechado ANTES da etapa fin014 (`listTitulosBorderoReceber`/`gravarBaixa`), com mensagem que aponta a causa (SN não é do processo ou não está finalizada), preservando idempotência | 100% dos `snDocCod` inválidos rejeitados na etapa `sn` (não na `fin014-done`) — hoje: 0% (só falha depois) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| % das leituras Conexos da feature envolvidas em `runWithRetry` | 0/1 (0%) | 100% (paridade com `listContasProjeto`/`resolveGcdCodByName`) | ❌ | `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1058` (novo `listSNsByProcesso`) vs. `:510-524` e `:1009-1035` (irmãos) |
| `ensureSid()` antes do POST na leitura nova | ausente | presente | ❌ | `ConexosGerDocProcessoClient.ts:1053-1098` |
| Timeout HTTP explícito no client Conexos | 40000 ms (herdado do axios.create) | 100% | ✅ | `src/backend/services/conexos.ts:116-121` |
| Paginação real na nova leitura (loop de páginas ou parada por `count`) | não (pageNumber=1 fixo, pageSize=50) | loop ou docstring que assuma cap | ⚠️ | `ConexosGerDocProcessoClient.ts:1092-1093` |
| Verificação prévia de que `snSelecionadaDocCod` pertence ao processo/filial e está finalizado | ausente | 100% na entrada da rama existente | ❌ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:418-462` |
| Retry no cliente FE (`fetchSNsDoProcesso`) | ausente (single `apiFetch`) | N/A localmente — retry vive no BE via `runWithRetry` | ⚠️ | `src/frontend/lib/recebimentos.ts:526-539` |
| Timeout explícito no `apiFetch` do FE | não observável no arquivo tocado | timeout de UX (ex.: 20-30 s + AbortController) | ⚠️ (fora do delta) | `src/frontend/lib/recebimentos.ts:529-536` (comportamento vem de `lib/http`) |
| Testes cobrindo a leitura nova (200/403/400) | 4 casos (listSNsByProcesso client + rota 200/403/400) | ≥3 ✅ | ✅ | `ConexosGerDocProcessoClient.test.ts:576-604`; `routes/recebimentos.test.ts:268-345` |
| Idempotência da execução preservada com `snSelecionadaDocCod` | precedência sobre `existente?.docCod`; chave `sn-real:{txnId}:{priCod}:{valor}` inalterada | preservada | ✅ | `RecebimentoNumerarioService.ts:355-358, 254` |
| Circuit breaker / degradation entre a rota e o Conexos | ausente | 1 por dependência crítica | ❌ | inexistente no delta (herdado do projeto) |

> ⚠️ **Não medível localmente**: taxa real de sucesso da nova rota em produção, latência p50/p95 do `POST /com299` para diferentes tamanhos de processo, MTTR do analista quando o painel de SN falha. Requer instrumentação CloudWatch/APM (o repo hoje só tem logs estruturados via `LogService`). Recomendação: emitir métrica de duração + contagem de falha em `listSNsByProcesso` (correlationId + priCod) e alarmar em taxa de erro > 2%/5min.

## 3. Tactics — Cobertura no nf-projects

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — leitura síncrona single-hop (Express → Conexos), sem heartbeat necessário no delta. | N/A | — |
| Heartbeat | N/A — a rota é on-demand (clique do analista); sem processo longo. | N/A | — |
| Monitor | `LogService` estruturado no BE; nada específico para a nova leitura (contagens/latência). | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1049-1117` — sem `logService.info/warn` de sucesso/duração da leitura |
| Timestamp | `docDtaEmissao` recuperado e projetado para ISO; correlationId de execução `sn-real:{txnId}:{priCod}:{valor}` estável. | ✅ presente | `ConexosGerDocProcessoClient.ts:1125`; `RecebimentoNumerarioService.ts:254` |
| Sanity Checking | Zod (`SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA`) + guarda defensivo `docVldTipo===9 && docVldTipoAdto===1` no BE; `snSelecionadaDocCod` NÃO é sanidade-checado (existência/filial/finalização). | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1099-1111`; ausência em `RecebimentoNumerarioService.ts:418-462` |
| Condition Monitoring | ausente na nova leitura (nenhuma métrica de taxa de rows>=cap, latência, empty). | ❌ ausente | — |
| Voting | N/A — leitura de fonte única. | N/A | — |
| Exception Detection | `try/catch` em `listSNsByProcesso` → `ConexosError({ endpoint, cause })`; rota propaga; FE `.catch` → toast. | ✅ presente | `ConexosGerDocProcessoClient.ts:1114-1116`; `routes/recebimentos.ts:390-393`; `AlocarProcessosDialog.tsx:316-318, 365-370` |
| Self-Test | N/A — nada exposto. | N/A | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — Conexos é fonte única de verdade. | N/A | — |
| Passive Redundancy | N/A — mesmo motivo. | N/A | — |
| Spare | N/A. | N/A | — |
| Exception Handling | `ConexosError` embrulha causa e endpoint. FE mostra a `error.message` no toast. | ✅ presente | `ConexosGerDocProcessoClient.ts:1114-1116`; `AlocarProcessosDialog.tsx:365-370` |
| Rollback | Não aplicável na leitura; na rama write “SN existente”, `etapaSn` é no-op (não há o que rolbackar); as etapas seguintes (fin014, com297) já usam ledger `execucaoRepository` com etapa persistida para retomada. | ✅ presente | `RecebimentoNumerarioService.ts:452-460, 1041-1113, 1116-1176` |
| Software Upgrade | N/A. | N/A | — |
| Retry | **AUSENTE na nova leitura.** `listSNsByProcesso` chama `this.base.listGenericPaginated` **diretamente**, sem `runWithRetry`. Os irmãos (`listContasProjeto:510`, `resolveGcdCodByName:1009`) fazem `this.base.runWithRetry(async () => { await ensureSid(); … })`. A docstring de `listSNsByProcesso` (linha 1046) alega o oposto: *“listGenericPaginated (já embrulha retry + ensureSid)”* — mas o adapter (`legacyConexosAdapter.ts:37-51`) só delega a `authenticatedPost` (401-retry apenas), NÃO ao `RetryExecutor` (1 retry/500 ms/jitter). | ❌ ausente | `ConexosGerDocProcessoClient.ts:1049-1117` vs. `:510-528` e `:1001-1035`; `ConexosBaseClient.ts:209-214`; `legacyConexosAdapter.ts:37-51` |
| Ignore Faulty Behavior | N/A. | N/A | — |
| Degradation | Modal degrada bem: o painel direito falha → analista pode escolher “Criar novo SN” (default), que não depende da lista. | ✅ presente | `AlocarProcessosDialog.tsx:287, 316-318` (default `CRIAR_NOVO_SN` + `erroSns` renderizado) |
| Reconfiguration | N/A. | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A. | N/A | — |
| State Resynchronization | Chave de idempotência `sn-real:{txnId}:{priCod}:{valor}` é preservada quando `snSelecionadaDocCod` está presente; `etapaSn` ainda respeita `existente?.etapa` para retomar. Precedência: `snSelecionadaDocCod` sobrepõe `existente?.docCod` — o ledger é atualizado só a partir da fin014. | ✅ presente | `RecebimentoNumerarioService.ts:254, 353-357, 452-460` |
| Escalating Restart | N/A. | N/A | — |
| Non-Stop Forwarding | N/A. | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | N/A — sem healthcheck no delta. | N/A | — |
| Transactions | Escritas irreversíveis do fluxo (fin014, com297) usam `postGenericOnce` e ledger `SolicitacaoNumerarioExecucaoRepository` (herança de outras frentes). O delta preserva isso — a rama “SN existente” não introduz escrita nova antes de `fin014`. | ✅ presente | `RecebimentoNumerarioService.ts:1041-1176` |
| Predictive Model | N/A — sem sinais preditivos no delta. | N/A | — |
| Exception Prevention | Zod parse do envelope + filtro defensivo `docVldTipo===9 && docVldTipoAdto===1` previne uma NC/ND ser interpretada como SN válida no FE. **Porém** o `snDocCod` submetido ao POST NÃO é revalidado — o BE aceita qualquer inteiro positivo (`z.coerce.number().int().positive().optional()`) e faz apenas o `assertUserCanActOnFilial(filCod)`. Uma lista stale (analista abriu antes de outra alocação finalizar/estornar), a digitação errada ou o cache client-side (`sns[processoSelecionado.priCod]`, `AlocarProcessosDialog.tsx:309`) resultam em falha tardia. | ⚠️ parcial | `ConexosGerDocProcessoClient.ts:1099-1111`; `routes/recebimentos.ts:396-427`; `RecebimentoNumerarioService.ts:418-462`; `AlocarProcessosDialog.tsx:309, 305-327` |
| Increase Competence Set | Docstring cita `HAR-confirmado` e amarra as constantes `SOLICITACAO_NUMERARIO_DOC_VLD_TIPO`/`_ADTO` (evita hardcodar 9/1). | ✅ presente | `ConexosGerDocProcessoClient.ts:1043-1047, 1088-1090` |

## 4. Findings (achados)

### F-availability-1: `listSNsByProcesso` não usa `runWithRetry` nem `ensureSid` — quebra paridade com os irmãos

- **Severidade**: P1 (alto — degrada QA mensurável em produção; single-point of transient failure na feature)
- **Tactic violada**: Retry (Recover from Faults) + Sanity Checking (Detect Faults: sessão)
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1049-1117`
- **Evidência (objetiva)**:
  ```
  // listSNsByProcesso (linhas 1057-1098) — NENHUM runWithRetry, NENHUM ensureSid:
  try {
      const page = await this.base.listGenericPaginated<Record<string, unknown>>(
          'com299',
          { fieldList: [...], filterList: {...}, pageNumber: 1, pageSize, ... },
          { filCod },
      );
      ...
  } catch (cause) {
      throw new ConexosError({ endpoint: path, cause });
  }

  // Sibling listContasProjeto (linhas 509-528) — padrão do arquivo:
  return await this.base.runWithRetry(async () => {
      await this.base.ensureSid();
      const page = await this.base.listGenericPaginated<Record<string, unknown>>(...);
      ...
  });
  ```
  A docstring (`:1046`) declara *“Leitura paginada idempotente → `listGenericPaginated` (já embrulha retry + ensureSid)”*. Não é verdade: o adapter (`legacyConexosAdapter.ts:37-51`) delega direto a `authenticatedPost` (só o 401-retry único), e o wrapper `ConexosBaseClient.listGenericPaginated` (`ConexosBaseClient.ts:209-214`) é passthrough. O único caminho que embrulha em `RetryExecutor` é `paginate` (`ConexosBaseClient.ts:260-318`), que `listSNsByProcesso` NÃO usa.
- **Impacto técnico**: um 500/502/503/timeout transitório do Conexos no meio do dia (comum durante fechamento) devolve `ConexosError` na primeira falha; sem o `RetryExecutor` (1 retry + 500 ms + jitter que os outros validadores usam) o painel de SN aparece vazio + toast de erro, e o analista repete o clique manualmente. Adicionalmente, se o cookie `sid` do Conexos expirou (o `authenticatedPost` faz um 401-retry único, mas se a sessão está no meio de re-login pelo mutex de `services/conexos.ts:166`, a chamada perde a corrida) — o `ensureSid()` explícito é a garantia de que o padrão do arquivo dá.
- **Impacto de negócio**: risco de o analista escolher “Criar novo SN” por engano (default do modal) achando que o processo não tem SN — cria SN duplicada no ERP (invariante I-Receb-3 fica vulnerável a uma decisão humana induzida por falha de transporte). Cada SN duplicada custa retrabalho contábil (estorno + limpeza no Conexos).
- **Métrica de baseline**: 0/1 leituras da feature envolvidas em `runWithRetry` (0%). Alvo: 1/1 (100%, paridade com `listContasProjeto`/`resolveGcdCodByName`).

### F-availability-2: `etapaSn` aceita `snSelecionadaDocCod` sem validar existência/processo/finalização — falha tarde em `fin014`

- **Severidade**: P1 (alto — atrasa MTTR do analista em cada falha; risco de baixa em SN errada)
- **Tactic violada**: Exception Prevention (Prevent Faults) + Sanity Checking (Detect Faults)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:418-462`; `src/backend/routes/recebimentos.ts:420-427`
- **Evidência (objetiva)**:
  ```typescript
  // etapaSn (:418-462): a rama "SN existente" NÃO faz nenhum check.
  const snSelecionada = ctx.snSelecionadaDocCod !== undefined;
  let snDocCod = snDocCodIn; // = ctx.snSelecionadaDocCod ?? existente?.docCod
  if (snDocCod === undefined) { /* fluxo criar novo */ }
  if (!snSelecionada && (…)) { /* finaliza — só no fluxo novo */ }
  return snDocCod; // devolve intocado; próxima etapa é fin014.criarBordero/validarTituloBaixa
  ```
  Nem a rota (`routes/recebimentos.ts:396-427`) nem o serviço checam: (a) que `snDocCod` existe no ERP, (b) que pertence ao `priCod` recebido, (c) que pertence ao `filCod` recebido, (d) que `docVldFinalizado===1`. O client já tem `getDocumento({ tela: 'com299', filCod, docCod })` (`ConexosGerDocProcessoClient.ts:916-931`), pronto para uma pré-verificação barata.
- **Impacto técnico**: um `snDocCod` inválido/stale/errado só falha na etapa `fin014` — provavelmente em `listTitulosBorderoReceber({filCod, docCod: snDocCod})` devolvendo vazio → `throw new Error("SN X não gerou título a receber ... a SN não ficou finalizável")` (`RecebimentoNumerarioService.ts:1063-1073`). A mensagem culpa a SN por não estar finalizada, quando o problema real pode ser "docCod de outro processo". Pior: se o `docCod` referencia a SN de OUTRO processo na mesma filial que **está** finalizada, a baixa fin014 é executada contra ela — irreversível. Uma escrita irreversível a partir de um input não-validado é P0 em security, mas do ponto de vista de availability é P1 porque o `assertUserCanActOnFilial` já limita o blast radius ao conjunto de SNs da mesma filial (não cross-tenant).
- **Impacto de negócio**: quando a lista de SN fica stale (outro analista finalizou/estornou uma SN entre a leitura do modal e o clique em "Processar"), a rama existente cai numa mensagem confusa que aponta para “SN não ficou finalizável” — MTTR do analista sobe (ele vai investigar a SN, quando o problema é a seleção). O caso concorrente é raro mas real: o modal cacheia por `priCod` (`AlocarProcessosDialog.tsx:309`) e nunca invalida.
- **Métrica de baseline**: 0% dos `snDocCod` são pré-validados antes de fin014 (etapa `sn` só falha se a SN não existir por alguma razão de transporte); alvo: 100% pré-validados no gate da etapa `sn`.

### F-availability-3: `listSNsByProcesso` fetch single-page (pageNumber=1, pageSize=50) — cap silencioso

- **Severidade**: P2 (médio — degrada QA em cenários de cauda longa)
- **Tactic violada**: Sanity Checking + Exception Prevention
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1055, 1092-1093`
- **Evidência (objetiva)**:
  ```
  const pageSize = params.pageSize ?? 50;
  ...
  pageNumber: 1,
  pageSize,
  ```
  Não há loop de páginas, nem parada por `count`, nem log de cap-hit. O envelope Zod (`SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA`) parseia `count` mas o método descarta. Contraste: `listCondPgtoPessoa` (`:843-879`) tem um loop pelo `count` documentado explicitamente porque o ERP ignora o `pageSize` pedido.
- **Impacto técnico**: um processo com >50 SNs (raro, mas há processos antigos com muitas SNs históricas quando `vldStatus ∈ {1,3}`) tem SNs invisíveis para o analista. O analista escolhe “Criar novo SN” achando que não há a que ele precisa → SN duplicada.
- **Impacto de negócio**: mesma classe de F-availability-1 (SN duplicada por decisão induzida pela ausência de dado), mas em cenário mais raro.
- **Métrica de baseline**: 0 processos com >50 SN cobertos; alvo: N/A na prática, mas o comportamento correto é log de `BUSINESS_WARN` com cap-hit + paginação por `count` ou docstring explícita assumindo o cap.

### F-availability-4: sem `Monitor`/instrumentação (latência, taxa de erro) na leitura nova

- **Severidade**: P2 (médio — MTTR de incidente sem observabilidade sobe)
- **Tactic violada**: Monitor + Condition Monitoring (Detect Faults)
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1049-1117`; `src/backend/routes/recebimentos.ts:366-394`
- **Evidência (objetiva)**: nenhum `logService.info/warn` de sucesso, contagem de rows ou duração. `LogService` só é chamado indiretamente via `ConexosError` na falha. Não há métrica emitida.
- **Impacto técnico**: se em produção 20% dos analistas passarem a ver painel de SN vazio, ninguém percebe até um chamado — não há alarme.
- **Impacto de negócio**: incidentes silenciosos → SN duplicadas em série antes de alguém notar.
- **Métrica de baseline**: 0 sinais telemétricos emitidos pela leitura nova. Alvo: ao menos duração + contagem de sucessos/falhas + `filCod`/`priCod` para dashboard.

### F-availability-5: FE não invalida cache de SN após um `Processar` bem-sucedido

- **Severidade**: P3 (baixo — janela de exposição curta; contorno trivial pelo analista)
- **Tactic violada**: State Resynchronization (Reintroduction)
- **Localização**: `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:305-327, 329-374`
- **Evidência (objetiva)**:
  ```typescript
  // Cache por priCod (:305-327) — carrega a lista uma vez e nunca invalida.
  if (sns[processoSelecionado.priCod] !== undefined) return

  // processar (:329-374) — após sucesso NÃO faz setSns() para refletir a nova SN no ERP.
  ```
- **Impacto técnico**: após um “Criar novo SN” concluído, a SN recém-criada NÃO aparece na lista até o modal reabrir. Se o analista voltar ao mesmo processo (raro nesta feature — o painel já mostra o `resultado`), verá lista stale.
- **Impacto de negócio**: no pior caso, cria segunda SN duplicada. Muito baixo porque o resultado do processo já é renderizado (`ResultadoAlocacao`), e o modal reabrindo re-fetcha.
- **Métrica de baseline**: N/A (efeito raro; contorno = fechar+abrir).

## 5. Cards Kanban

### [availability-1] Embrulhar `listSNsByProcesso` em `runWithRetry` + `ensureSid` (paridade)

- **Problema**
  > A leitura nova `ConexosGerDocProcessoClient.listSNsByProcesso` (`:1058`) NÃO usa `runWithRetry` nem chama `ensureSid()` antes do POST — quebra o padrão do arquivo. Um blip transitório (5xx/timeout) do `com299/list` derruba o painel de SN do modal na primeira falha; um `sid` expirado + corrida com o mutex de re-login (`services/conexos.ts:166`) idem. A docstring afirma que o `listGenericPaginated` já faz retry/ensureSid — mas o adapter (`legacyConexosAdapter.ts:37-51`) só delega ao `authenticatedPost` (401-retry único), não ao `RetryExecutor`. Efeito: analista vê lista vazia com erro, opta por “Criar novo SN” achando que não há SN → SN duplicada.

- **Melhoria Proposta**
  > Embrulhar o corpo de `listSNsByProcesso` em `this.base.runWithRetry(async () => { await this.base.ensureSid(); const page = await this.base.listGenericPaginated(...); ... })`, espelhando `listContasProjeto` (`:510-528`) e `resolveGcdCodByName` (`:1009-1035`). Corrigir a docstring (`:1046`) para descrever o comportamento real. Tactic: **Retry** + **Sanity Checking** (sessão). Testar com um mock que rejeita a 1ª chamada e resolve na 2ª (padrão já existente em `ConexosSispagClient.test.ts:60-66`).

- **Resultado Esperado**
  > `listSNsByProcesso` absorve 1 falha transitória com 500 ms de delay + jitter (política do `RetryExecutor` compartilhado). % de leituras da feature em `runWithRetry`: 0% → 100%. Falhas de sessão viram re-login uma vez em vez de erro para o usuário.

- **Tactic alvo**: Retry (Recover from Faults)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Leituras Conexos da feature em `runWithRetry`: 0/1 → 1/1
  - Chamadas com `ensureSid()` prévio: 0/1 → 1/1
  - Teste unitário que valida retry em erro transitório: 0 → 1
- **Risco de não fazer**: SN duplicada quando um blip do Conexos derruba a lista; MTTR do analista sobe (retry manual). Em 6 meses, com centenas de execuções diárias durante fechamento, é razoável esperar ≥1 incidente/mês.
- **Dependências**: nenhuma.

### [availability-2] Gatekeeper de `snSelecionadaDocCod` em `etapaSn` (pré-validar existência/processo/filial/finalização)

- **Problema**
  > `etapaSn` aceita `ctx.snSelecionadaDocCod` como oráculo sem verificar nada (`RecebimentoNumerarioService.ts:418-462`). Um `docCod` errado (lista stale, digitação, cache do FE em `AlocarProcessosDialog.tsx:309` que nunca invalida) só falha na etapa `fin014`, onde a mensagem culpa a SN por não estar finalizada (`RecebimentoNumerarioService.ts:1069-1072`) — enganosa. Pior: se o `docCod` referencia acidentalmente uma SN de outro processo na mesma filial e finalizada, a baixa fin014 é executada contra ela (irreversível). O `assertUserCanActOnFilial` limita o blast a SNs da mesma filial, mas não previne o erro dentro dela.

- **Melhoria Proposta**
  > Em `etapaSn`, quando `snSelecionada`, ANTES de retornar `snDocCod`: (1) `getDocumento({ tela: 'com299', filCod, docCod: snDocCod })` (já existe: `ConexosGerDocProcessoClient.ts:916-931`); (2) validar `priCod === ctx.priCod`, `filCod === ctx.filCod` e `docVldFinalizado === 1`; (3) falha-fechado com mensagem específica (`NumerarioGapError({ etapa: 'sn', message: "SN X não pertence ao processo Y (pertence a Z)" })` etc). Emite `logService.warn` para auditar tentativas com `docCod` inválido. Tactic: **Exception Prevention** + **Sanity Checking**.

- **Resultado Esperado**
  > `snDocCod` inválido/stale/errado falha na etapa `sn` (não em `fin014-done`), com mensagem que aponta a causa. 0% de baixa fin014 executada contra SN de processo diferente do enviado. MTTR do analista para caso de lista stale: alto (mensagem confusa em fin014) → baixo (mensagem exata na entrada).

- **Tactic alvo**: Exception Prevention (Prevent Faults)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2, F-availability-5
- **Métricas de sucesso**:
  - % `snSelecionadaDocCod` pré-validados: 0% → 100%
  - Testes com `docCod` de outro processo (fail-closed na etapa `sn`): 0 → 1
  - Testes com `docCod` inexistente: 0 → 1
- **Risco de não fazer**: incidente com baixa fin014 executada contra SN errada (irreversível). O cenário exige coincidência (mesma filial, ambos finalizados, docCod errado), mas o custo é alto.
- **Dependências**: nenhuma.

### [availability-3] Paginação real (ou docstring explícita) em `listSNsByProcesso`

- **Problema**
  > `listSNsByProcesso` faz um único fetch `pageNumber:1, pageSize:50` (`ConexosGerDocProcessoClient.ts:1092-1093`) sem loop e sem parada por `count`. Um processo com >50 SNs (vldStatus∈{1,3}) tem SNs invisíveis silenciosamente — o mesmo padrão que `listCondPgtoPessoa` (`:843-879`) diagnosticou para condições de pagamento. Risco: analista escolhe “Criar novo SN” porque não vê a que precisa, criando duplicata.

- **Melhoria Proposta**
  > Duas opções (custo/benefício): (a) paginar pelo `count` como `listCondPgtoPessoa` faz, com cap `MAX_PAGES` e log `BUSINESS_WARN` no cap-hit; (b) manter single-page mas emitir `logService.warn` quando `page.rows.length === pageSize` e adicionar cláusula na docstring assumindo o cap explicitamente. Escolha (a) se o produto quiser suportar processos com >50 SNs; (b) se aceitar-se documentar o limite. Tactic: **Sanity Checking** + **Monitor**.

- **Resultado Esperado**
  > Nenhum SN elegível é silenciosamente escondido. Painel de SN mostra tudo ou avisa que truncou.

- **Tactic alvo**: Sanity Checking (Detect Faults)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Cap-hit logado quando rows === pageSize: 0 → 1
  - Se paginar: cobertura de processos com >50 SNs: 0% → 100%
- **Risco de não fazer**: SN duplicada em caso raro (processo com histórico longo).
- **Dependências**: nenhuma.

### [availability-4] Instrumentar `listSNsByProcesso` — duração + contagem + `filCod`/`priCod`

- **Problema**
  > Nenhum sinal telemétrico é emitido pela leitura nova. Se a rota passar a falhar 20% do tempo, ninguém percebe até chegar chamado. Contraste com o padrão do arquivo (`applyPaymentConditionIfRequired:508-518` — `logService.info` de eventos raros; `requiresRegisteredPaymentCondition:615-629` — `logService.warn` em degradação). Sem métrica, a promessa de availability é opaca.

- **Melhoria Proposta**
  > Emitir `logService.info({ type: BUSINESS_INFO, message: 'listSNsByProcesso', data: { filCod, priCod, rows: envelope.rows.length, count: envelope.count, duracaoMs } })` no happy path e enriquecer o `ConexosError` da falha com o `filCod`/`priCod` no `data`. Se houver métrica CloudWatch/APM configurada (fora do delta), plugar. Tactic: **Monitor**.

- **Resultado Esperado**
  > Dashboard de produção mostra latência p50/p95 + taxa de erro por filial. Alarme se erro > 2%/5min.

- **Tactic alvo**: Monitor (Detect Faults)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Logs estruturados de sucesso: 0 → 1 por chamada
  - Contexto no erro: `endpoint` + `filCod` + `priCod`
- **Risco de não fazer**: incidentes silenciosos até um analista ligar.
- **Dependências**: nenhuma.

### [availability-5] Invalidar cache `sns[priCod]` no FE após um `Processar` bem-sucedido

- **Problema**
  > O FE cacheia por `priCod` a lista de SN (`AlocarProcessosDialog.tsx:309`) e nunca invalida — nem depois de um `Processar` que cria uma SN nova ou consome uma existente. Se o analista voltar ao mesmo processo, vê lista stale. Efeito prático raro (o modal já mostra `ResultadoAlocacao` do processo), mas fora do contrato de State Resynchronization.

- **Melhoria Proposta**
  > No `processar` (`:329-374`), após `resultado.status === 'settled'` (ou `skipped`), remover a entrada `sns[processo.priCod]` do estado (`setSns((prev) => { const next = { ...prev }; delete next[processo.priCod]; return next })`), para forçar re-fetch se o analista retornar. Tactic: **State Resynchronization**.

- **Resultado Esperado**
  > Sem lista stale após operação. Custo: 1 re-fetch adicional por processo processado (aceitável).

- **Tactic alvo**: State Resynchronization (Reintroduction)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Reincidência de lista stale após `Processar`: qualquer → 0
- **Risco de não fazer**: caso raro de SN duplicada por retomar processo já operado.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estritamente restrito aos 4 arquivos tocados pela ADR-0027; código herdado (executors, ConexosBaseClient, RetryExecutor) só citado como baseline.
- Métricas de latência/taxa real (p50/p95, MTTR, blank-list rate) **não medíveis localmente** — repositório não tem CloudWatch/APM instrumentado; findings baseados em análise estática comparativa com os métodos irmãos do mesmo arquivo.
- Conexão cross-QA: F-availability-2 tem sobreposição com **security** (input não validado em rota que dispara escrita irreversível) e com **integrability** (contrato do endpoint aceita `snDocCod` livre). O `qa-consolidator` deve dedup se `qa-security`/`qa-integrability` levantarem o mesmo ponto.
- F-availability-1 vs. docstring: a discrepância entre o que a docstring afirma e o comportamento real do adapter é o achado mais forte — o retry existe no `RetryExecutor` que os irmãos usam, mas o método novo não o instancia; é 1 linha de fix + paridade com o resto do arquivo.
