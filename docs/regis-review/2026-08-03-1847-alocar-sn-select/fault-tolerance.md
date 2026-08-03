---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-03-1847-alocar-sn-select
agent: qa-fault-tolerance
generated_at: 2026-08-03T18:47:00Z
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista escolhe uma SN existente no modal Alocar e clica em Processar | Clique repetido / retry após 5xx / falha de rede mid-flight na baixa fin014 ou na emissão da NDe com297 contra o `docCod` selecionado | `RecebimentoNumerarioService.processarAlocacao` (ramo ADR-0027 `snSelecionadaDocCod`), `ConexosGerDocProcessoClient.listSNsByProcesso`, `ConexosFin014Client` (baixa), `ConexosNdeClient` (homologação) | Escrita real habilitada (`conexosWriteEnabled=true`, `conexosDryRun=false`) contra o Conexos de produção | Nenhuma SN duplicada (invariante I-Receb-3); nenhuma baixa duplicada na mesma SN; nenhuma NDe duplicada; um re-POST com o mesmo `(txnId, priCod, valor)` retoma pelo ledger; SN existente sem título a receber é fail-closed sem baixa; SN não finalizada (`vldStatus=1`) é surfada como erro nomeado, nunca uma baixa que "some" | 0 duplicatas de SN/baixa/NDe; 100% dos re-POSTs no mesmo `key` retornados como `skipped`/`settled`; MTTR do reprocess ≤ 1 clique (retry idempotente); 0 documentos "pendurados" sem trilha auditável |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotency-key preservada no ramo SN-existente (mesma fórmula `sn-real:{txnId}:{priCod}:{valor}`) | 1/1 (não muda com `snSelecionadaDocCod`) | 1/1 | ✅ | `RecebimentoNumerarioService.ts:254` |
| `etapaSn` pula geração + finalização quando SN é selecionada (I-Receb-3) | 2/2 saltos (validaGeracao/gerar/completar E finalizar) | 2/2 | ✅ | `RecebimentoNumerarioService.ts:425-461` |
| Guard fail-closed quando `listTitulosBorderoReceber` devolve vazio no `docCod` selecionado | Presente (throw nomeado, `markError`, status `error`) | Presente | ✅ | `RecebimentoNumerarioService.ts:1063-1073` |
| Guard de status (`vldStatus`) da SN selecionada antes de baixar (recusar `Aberta`/não-finalizada) | Ausente — a rota `GET /processos/:priCod/sns` devolve `vldStatus IN {1,3}` (Aberta+Finalizada) sem filtrar; o serviço confia no fail-closed do `listTitulosBorderoReceber` | Presente OU ADR explícito documentando "delegado ao título vazio" | ⚠️ | `ConexosGerDocProcessoClient.ts:1090`, `RecebimentoNumerarioService.ts:1063-1073` |
| Testes cobrindo o ramo SN-existente (unit + integração) | 3 (service happy-path com SN selecionada; rota encaminha `snDocCod`; rota omite quando ausente) | ≥ 3 | ✅ | `RecebimentoNumerarioService.test.ts:255-283`; `recebimentos.test.ts:410-440` |
| Teste de retry idempotente do ramo SN-existente (re-POST com mesmo `key` → `skipped`) | Ausente (só o ramo "Criar novo SN" tem cobertura em `retomada (ledger…)`) | Presente | ⚠️ | Ausência em `RecebimentoNumerarioService.test.ts` (grep por `snSelecionadaDocCod` + `alreadySettled`/`findByIdempotencyKey`) |
| Teste FAIL-CLOSED do título vazio no ramo SN-existente (SN "vazia" selecionada) | Ausente — o fail-closed do `listTitulosBorderoReceber` só é testado indiretamente pelo caminho "Criar novo SN" | Presente | ⚠️ | Ausência em `RecebimentoNumerarioService.test.ts` (grep por `listTitulosBorderoReceber.*mockResolvedValue\(\[\]\)`) |
| Trilha de auditoria (persistida) do settle contra SN existente — `snDocCod` no ledger diferencia SN gerada por nós de SN reutilizada | Parcial — o ledger grava `doc_cod = snSelecionadaDocCod` via o path `let snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` + `markSettled({docCod: snDocCod})`, mas NÃO há uma coluna/flag "reused vs generated" (indistinguível ex-post) | Flag explícita `sn_reutilizada` no ledger OU no log estruturado com tipo próprio | ⚠️ | `RecebimentoNumerarioService.ts:357,382-386` |
| DLQ / fila de exceção do analista para uma alocação SN-existente que falhou mid-flight | N/A no escopo desta feature (o pipeline recebimentos é síncrono via API; DLQ vive na ingestão de extrato — fora do ramo ADR-0027) | N/A | N/A | `routes/recebimentos.ts:441-537` (sync POST) |

> ⚠️ **Não medível localmente**: taxa real de re-POSTs do ramo ADR-0027 em produção e prova empírica de zero duplicatas de baixa na mesma SN. Requer CloudWatch + audit trail em produção. Recomendação: emitir métrica `alocacao_sn_existente_retry_total{status=skipped|settled|error}` no `LogService` e alarmar em `error` > 0 durante 15 min.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A no delta (não há substituição de componente redundante — a SN é o próprio recurso reutilizado) | N/A | — |
| Replacement | N/A | N/A | — |
| Predictive Model | N/A no delta (o pré-flight READ-ONLY do serviço é anterior à ADR-0027 e continua ativo, mas não muda com SN-existente) | N/A | `RecebimentoNumerarioService.ts:911` |
| Increase Competence Set | O ramo SN-existente ADICIONA uma competência: agora a alocação sabe lidar com o caso "SN já existe no ERP" sem duplicar (universo antes assumia sempre criar) | ✅ presente | `RecebimentoNumerarioService.ts:412-461` |
| Sanity Checking | Zod no boundary do `com299/list` (envelope + filtro defensivo `docVldTipo===9 && docVldTipoAdto===1`, evita NC/ND vazar como SN) | ✅ presente | `ConexosGerDocProcessoClient.ts:1099-1112` |
| Comparison | N/A no delta (não há voting/quorum) | N/A | — |
| Timestamp | Ledger `criadoEm`/`atualizadoEm` + `emitidaEm` na NDe (herdado) | ✅ presente (herdado) | `RecebimentoNumerarioService.ts:1301` |
| Timeout | Herdado (`RetryExecutor`/`runWithRetry` do base client + `ndePollTimeoutMs`); ADR-0027 não adiciona novo timeout | ✅ presente (herdado) | `ConexosGerDocProcessoClient.ts:1057-1058` (usa `listGenericPaginated` → `runWithRetry`) |
| Condition Monitoring | Ausente — não há job que verifique periodicamente se uma alocação `reconciling` contra SN-existente ficou órfã (ex.: `docCod` selecionado deletado no ERP entre listagem e Processar) | ⚠️ parcial | Ausência em `src/backend/lambda/job` (o repo hoje é Express; ainda não tem job scheduler) |
| Self-Test | O `listTitulosBorderoReceber` fail-closed no vazio é um auto-teste "essa SN tem título a baixar?" antes de gravar a baixa | ✅ presente | `RecebimentoNumerarioService.ts:1068-1073` |
| Voting | N/A | N/A | — |
| Redundancy | N/A no delta | N/A | — |
| Recovery (Rollback) | Não aplica ao ERP externo (não desfazemos escrita no Conexos); o ledger marca `error` com `markError` — recovery é forward | ✅ presente (forward-only, herdado) | `RecebimentoNumerarioService.ts:1394-1398` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | State resync via ledger (`findByIdempotencyKey` + `etapa`) permite re-POST retomar de onde parou — INCLUSIVE no ramo SN-existente, pois `snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod` prioriza a seleção do analista | ✅ presente | `RecebimentoNumerarioService.ts:353-357` |
| Rollback | (ver Recovery acima) | ✅ presente | idem |
| Repair State | N/A no delta (não há repair automático — o analista reprocessa) | N/A | — |
| Idempotent Replay | Chave `sn-real:{txnId}:{priCod}:{valor}` INALTERADA pela ADR-0027 (não incorpora `snSelecionadaDocCod`) — o replay do mesmo `(txn, processo, valor)` cai em `alreadySettled` ou retoma pela etapa; se o analista trocar a SN escolhida entre duas tentativas com o MESMO trio, o ledger reusará o `docCod` já persistido (a nova seleção é ignorada silenciosamente na retomada) | ⚠️ parcial | `RecebimentoNumerarioService.ts:254, 343-346, 353-357` |
| Compensating Transaction | Ausente (por design — o Conexos não expõe undo limpo de baixa/NDe; ADR-0027 herda a política forward-recovery) | ⚠️ parcial (política, sem runbook novo) | `RecebimentoNumerarioService.ts:1380-1415` |
| Reconcile | Ausente para SN-existente: não há job que compare "SN selecionada tem baixa registrada aqui × está realmente baixada no fin014?" (delegado a inspeção manual do analista) | ⚠️ parcial | — |
| Quarantine | Status `error` + `markError` persiste a alocação com etapa/mensagem — o analista lê via `GET /recebimentos/execucoes?status=error`; equivalente a quarentena | ✅ presente | `routes/recebimentos.ts:555-580` |

## 4. Findings (achados)

### F-fault-tolerance-1: idempotency-key ignora `snSelecionadaDocCod` — trocar a SN entre retries é silenciosamente descartado

- **Severidade**: P1
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:254, 353-357`
- **Evidência (objetiva)**:
  ```
  const key = `sn-real:${txnId}:${priCod}:${valor}`;      // linha 254 — não inclui snSelecionadaDocCod
  ...
  // linhas 353-357:
  const existente = await this.execucaoRepository.findByIdempotencyKey(key);
  let etapa: SolicitacaoNumerarioEtapa = existente?.etapa ?? 'sn';
  let snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod;  // seleção nova PERDE para docCod já persistido
  ```
- **Impacto técnico**: Se um `processar` para `(txn-1, priCod=90001, valor=15000)` grava `docCod=18202` no ledger (via geração OU via seleção anterior) e o analista, num segundo clique com **outra** SN selecionada (`snSelecionadaDocCod=18300`), enviar o mesmo `(txn, priCod, valor)`, o `existente?.docCod` (18202) vence a expressão `??` — o retry baixará contra a SN **antiga**, ignorando a nova escolha do humano sem sinal de erro. O contrato aparente ("processar contra a SN que eu escolhi") é violado sem log de aviso.
- **Impacto de negócio**: Baixa/NDe emitidas contra o documento errado (dinheiro cai na SN antiga). Como não há duplicata, o incidente só é detectado por reconciliação manual entre o extrato e o Conexos — potencialmente horas/dias depois. Recuperação exige estorno manual no Conexos + nova alocação.
- **Métrica de baseline**: 0 avisos/warnings no fluxo quando `ctx.snSelecionadaDocCod !== existente.docCod`; teste `RecebimentoNumerarioService.test.ts` não cobre este cenário (grep negativo por `snSelecionadaDocCod.*!==.*existente`).

### F-fault-tolerance-2: sem guard de `vldStatus` — uma SN "Aberta" (não finalizada) selecionada segue para fin014 confiando só no fail-closed do título vazio

- **Severidade**: P1
- **Tactic violada**: Sanity Checking / Self-Test (defesa em profundidade)
- **Localização**: `src/backend/domain/client/ConexosGerDocProcessoClient.ts:1090` (`'vldStatus#IN': ['1', '3']`); `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:412-461` (`etapaSn` do ramo selecionado); `src/backend/routes/recebimentos.ts:396-427` (schema aceita qualquer `snDocCod > 0`)
- **Evidência (objetiva)**:
  ```
  // ConexosGerDocProcessoClient.ts:1090 — a listagem entrega SNs Abertas E Finalizadas ao FE:
  'vldStatus#IN': ['1', '3'],
  ...
  // RecebimentoNumerarioService.ts:452 — a etapa PULA finalizarDocumento para toda SN selecionada,
  // assumindo que já está finalizada; nada valida vldStatus antes:
  if (!snSelecionada && (existente?.etapa === undefined || existente.etapa === 'sn')) {
      const finMsgs = await this.gerDocClient.finalizarDocumento({...});
  ```
  Comentário do ADR-0027, seção "Known follow-up": *"whether a non-finalized ('Aberta') selected SN needs finalization before baixa"* — o próprio prompt reconhece o gap.
- **Impacto técnico**: Uma SN `vldStatus=1` (Aberta) selecionada pelo analista chega ao `etapaFin014` sem ter passado por `finalizarDocumento`. O `listTitulosBorderoReceber` provavelmente devolve `[]` (uma SN Aberta ainda não gerou título a receber — evidência HML doc 731 no comentário: `docVldFinalizado:0` ⟹ `mnyTitValor:0`) e o serviço faz `throw` com mensagem *"SN X não gerou título a receber ... a SN não ficou finalizável"* (`RecebimentoNumerarioService.ts:1069-1073`). A mensagem aponta o dedo para o lugar certo, MAS a UX é ruim: o analista foi induzido a escolher a SN Aberta porque a lista permitiu, e só descobre o problema depois de clicar Processar (que já criou um borderô fin014 e chamou `criarBordero` — escrita irreversível). O borderô fica **finalizado sem baixa** no Conexos.
- **Impacto de negócio**: Borderô órfão no fin014 (criado e finalizado sem baixa) requer limpeza manual. O analista repete a operação sem saber que já sujou o ERP. Escala mal quando 3-5 SNs Abertas convivem com Finalizadas na mesma tela.
- **Métrica de baseline**: 0 guards de `vldStatus === 3` no service (`grep -n "vldStatus" src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts` → nenhum resultado); 0 testes negativos para SN Aberta selecionada (`grep -n "vldStatus.*1\|Aberta" src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts` → nenhum resultado no ramo `snSelecionadaDocCod`).

### F-fault-tolerance-3: fail-closed do título vazio no ramo SN-existente é INFERIDO, não testado

- **Severidade**: P2
- **Tactic violada**: Self-Test (cobertura de teste)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1063-1073`; `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:255-283`
- **Evidência (objetiva)**:
  ```
  // Service: fail-closed genérico (independente do ramo)
  const titulo = titulos[0];
  if (titulo === undefined) {
      throw new Error(
          `SN ${snDocCod} não gerou título a receber (lov/TituloBorderoReceber vazio) — ...`
      );
  }
  ```
  O único teste do ramo SN-existente (`RecebimentoNumerarioService.test.ts:255`) programa `listTitulosBorderoReceber` para **devolver título**, então não exercita o fail-closed contra uma SN selecionada vazia. A cobertura desse guard só existe no fluxo "Criar novo SN" (implicitamente).
- **Impacto técnico**: Um refactor futuro que quebre a checagem (ex.: alguém adiciona `?? { docCod: snDocCod, titCod: 1 }` como default) não é pego por teste no ramo ADR-0027. Regressão silenciosa.
- **Impacto de negócio**: Baixa contra título inexistente ⟹ erro do ERP em runtime + reprocessamento manual pelo analista. Menor que F-1/F-2 porque o ERP é a última barreira, mas o ponto de detecção fica no lugar errado (mensagem confusa em produção).
- **Métrica de baseline**: 0 testes com `snSelecionadaDocCod` + `listTitulosBorderoReceber.mockResolvedValue([])`.

### F-fault-tolerance-4: retomada / retry idempotente do ramo SN-existente não tem teste explícito

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay (cobertura de teste)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.test.ts:955-987` (só cobre `Criar novo SN`)
- **Evidência (objetiva)**: Existe um teste `com fin014-done no ledger, NÃO recria SN nem borderô (retoma da nota de débito)` para o fluxo "Criar novo SN". Não existe o simétrico para SN-existente — o cenário de "clicar Processar duas vezes no mesmo `(txn, priCod, valor, snSelecionadaDocCod)`" não é validado. Grep por `alreadySettled.*snSelecionada` ou `findByIdempotencyKey.*snSelecionada` em `RecebimentoNumerarioService.test.ts` → nenhum resultado.
- **Impacto técnico**: A afirmação do ADR-0027 (*"reusa a idempotência `sn-real:{txnId}:{priCod}:{valor}`"*) fica sem prova executável para o novo ramo. Combinado com F-1, esconde bugs de retomada específicos do caminho SN-existente (ex.: `ctx.snSelecionadaDocCod` NÃO é persistido no ledger, apenas o `snDocCod` derivado — se o `etapa` foi só até `fin014` no primeiro retry, o segundo retry perde a informação de que a SN veio de seleção, não geração — hoje o comportamento acidental é correto porque o `etapaSn` pula `finalizarDocumento` também quando `snSelecionada=false && existente.etapa >= 'sn-finalizar'`, mas nada garante isso via teste).
- **Impacto de negócio**: Regressão futura silenciosa. Alocação retryada pode re-finalizar ou re-baixar. Não é bloqueante porque a chance de manifestação depende do refactor específico, mas P2 pela ausência de guarda de rede.
- **Métrica de baseline**: 0 testes com `snSelecionadaDocCod` + `findByIdempotencyKey.mockResolvedValue({status:'settled', ...})`.

### F-fault-tolerance-5: audit trail não distingue "SN reutilizada" de "SN gerada por nós"

- **Severidade**: P2
- **Tactic violada**: Timestamp / Audit trail
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:355-357, 382-386, 1290-1303`
- **Evidência (objetiva)**:
  ```
  // linha 357: mesma coluna `docCod` guarda ambos os casos
  let snDocCod = ctx.snSelecionadaDocCod ?? existente?.docCod;
  ...
  // linhas 382-386: markSettled persiste apenas docCod, sem flag "reused"
  await this.execucaoRepository.markSettled(key, {
      ...(snDocCod !== undefined ? { docCod: snDocCod } : {}),
      ...(ndDocCod !== undefined ? { ndDocCod } : {}),
      ...(homolog.erpResponse !== undefined ? { erpResponse: homolog.erpResponse } : {}),
  });
  ```
  O único vestígio de que o analista selecionou uma SN existente vive **na request HTTP** (body `snDocCod`) e no `EscritaCtx` in-memory — nada persiste "esta alocação reutilizou SN X vs. criou SN Y". A entidade `NotaDebitoEletronica` gravada em `ndeRepository.save` (1290-1303) também não carrega esse flag.
- **Impacto técnico**: Auditoria ex-post ("quantas alocações usaram SN existente no mês? quais analistas escolhem reutilizar?") exige inferência lateral (checar se `doc_cod` já existia antes do `criado_em` da execução — join custoso e frágil).
- **Impacto de negócio**: Sem sinal explícito, o feedback loop de "a feature ADR-0027 está sendo usada?" fica cego. Baixa severidade porque não afeta correção, mas prejudica a métrica de adoção da feature e complica investigação de incidentes.
- **Métrica de baseline**: 0 colunas/flags `sn_reutilizada`/`origem_sn` no ledger; 0 logs `BUSINESS_INFO` com tipo próprio ao entrar no ramo SN-existente (grep negativo em `etapaSn` por `logService.info.*snSelecionada`).

## 5. Cards Kanban

### [fault-tolerance-1] Preservar a seleção do analista quando `snSelecionadaDocCod` divergir do `existente.docCod`

- **Problema**
  > No ramo ADR-0027, se o analista clicar Processar uma segunda vez com uma SN diferente selecionada mantendo o mesmo `(txnId, priCod, valor)`, o serviço reutiliza silenciosamente o `docCod` gravado na primeira tentativa (`existente?.docCod`), ignorando a nova seleção. A baixa vai para a SN errada sem log de alerta.

- **Melhoria Proposta**
  > Em `RecebimentoNumerarioService.rodarEtapas` (linha 357), detectar `ctx.snSelecionadaDocCod !== undefined && existente?.docCod !== undefined && ctx.snSelecionadaDocCod !== existente.docCod` e (a) OU incorporar `snSelecionadaDocCod` na `key` (`sn-real:{txnId}:{priCod}:{valor}:{snSel|new}`) para criar uma execução separada, (b) OU fail-closed com mensagem "Alocação já executada contra SN X — para trocar, use /recebimentos/execucoes ou estorne". Alternativa mais leve: log `BUSINESS_WARN` obrigatório + preservar a seleção nova. Tactic Bass: **Idempotent Replay** + **Sanity Checking**. Arquivos: `RecebimentoNumerarioService.ts:353-357`.

- **Resultado Esperado**
  > Uma re-execução com SN diferente ou (a) cria nova execução com key distinta e o analista consegue baixar contra a SN correta, ou (b) devolve 409/`error` claro; nunca silenciosa. Métrica: 100% dos cenários `snSel_new != snSel_prev` gera log/erro observável (hoje: 0%).

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Divergência SN atual × SN retomada: 0 casos silenciosos (100% logados/erros)
  - Teste `RecebimentoNumerarioService.test.ts`: +1 caso cobrindo `snSelecionadaDocCod` × ledger com `docCod` diferente
- **Risco de não fazer**: Baixa contra documento errado descoberta só por reconciliação manual (horas/dias); estorno + realocação exigidos pelo analista, sem trilha do erro.
- **Dependências**: nenhuma

### [fault-tolerance-2] Guard de `vldStatus=3` (Finalizada) antes de aceitar uma SN selecionada para baixa

- **Problema**
  > A rota lista SNs com `vldStatus IN {1,3}` (Aberta + Finalizada) e o serviço não verifica o status antes de criar o borderô fin014. Uma SN Aberta selecionada gera borderô órfão (`criarBordero` + `finalizarBordero` sem baixa), porque o `listTitulosBorderoReceber` devolve vazio e o serviço aborta com mensagem confusa DEPOIS de já ter tocado o ERP.

- **Melhoria Proposta**
  > Duas frentes: (1) no `RecebimentoNumerarioService.etapaSn` (ou preferencialmente ANTES de `etapaFin014`), quando `snSelecionada`, chamar `getDocumento({tela:'com299', docCod})` e exigir `docVldFinalizado === 1` — reusa a checagem já existente em `ConexosGerDocProcessoClient.assertDocumentoFinalizado`; senão fail-closed com "SN X selecionada está Aberta (não finalizada) — finalize no Conexos ou escolha outra". (2) OU, alternativa modelada no ADR-0027 (finalizar a SN Aberta antes da baixa) — decisão de produto pendente, já registrada como *known follow-up*. Tactic Bass: **Self-Test** (checar o pré-requisito antes de agir). Arquivos: `RecebimentoNumerarioService.ts:412-461` + eventual filtro `vldStatus#EQ:3` na lista se a decisão for "só finalizadas na UI".

- **Resultado Esperado**
  > SN Aberta selecionada retorna `status='error'` ANTES de criar borderô (0 borderôs órfãos por SN Aberta). Mensagem de erro nomeia o problema real (não "título vazio"). Métrica: 100% das seleções `vldStatus!=3` bloqueadas antes do fin014 (hoje: 0%).

- **Tactic alvo**: Self-Test
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Borderôs órfãos gerados a partir de SN Aberta: alvo 0 (hoje: N — não medido, mas > 0 potencial)
  - Cobertura: teste `SN Aberta selecionada → error, sem chamar criarBordero`
- **Risco de não fazer**: Poluição do fin014 com borderôs vazios; retrabalho manual do analista; UX confusa quando a mensagem aponta "título vazio" mas a causa raiz é "SN não finalizada".
- **Dependências**: decisão do produto (item known follow-up do prompt): finalizar automaticamente vs. fail-closed vs. filtrar na UI.

### [fault-tolerance-3] Cobrir com teste o fail-closed do título vazio no ramo SN-existente

- **Problema**
  > O guard `RecebimentoNumerarioService.ts:1068-1073` (throw quando `listTitulosBorderoReceber` devolve vazio) é o último defesa do ramo SN-existente contra uma SN "vazia" selecionada, mas o novo teste `SN existente selecionada` (linha 255) programa o LOV para devolver título e não exercita o vazio. Regressão silenciosa possível.

- **Melhoria Proposta**
  > Adicionar em `RecebimentoNumerarioService.test.ts` um caso `it('SN existente selecionada com título vazio (fail-closed): error na etapa fin014 sem escrever baixa', ...)` que programe `listTitulosBorderoReceber.mockResolvedValue([])`, chame `processarAlocacao({snSelecionadaDocCod: 18202})` e verifique (a) `out.status === 'error'`, (b) `out.etapa === 'fin014'`, (c) `gravarBaixa` **não** chamado, (d) mensagem contém o `docCod` selecionado. Tactic Bass: **Self-Test** (cobertura da própria checagem).

- **Resultado Esperado**
  > Guarda de regressão executável para o ponto de falha mais provável do ramo SN-existente. Métrica: cobertura do fail-closed no branch selecionado 0% → 100%.

- **Tactic alvo**: Self-Test
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes cobrindo fail-closed no ramo SN-existente: 0 → ≥1
- **Risco de não fazer**: Um refactor futuro derruba silenciosamente a proteção e o próximo bug aparece só em produção.
- **Dependências**: nenhuma

### [fault-tolerance-4] Teste de retomada idempotente do ramo SN-existente (re-POST → `skipped`/`settled`)

- **Problema**
  > O ADR-0027 afirma que a idempotência `sn-real:{txn}:{pri}:{valor}` continua valendo para o ramo SN-existente, mas o único teste de retomada (`retomada (ledger mostra etapa concluída)`) só cobre "Criar novo SN". Sem prova executável, uma regressão futura no `etapaSn`/`etapaFin014` do ramo selecionado passa nos testes.

- **Melhoria Proposta**
  > Adicionar dois casos ao `RecebimentoNumerarioService.test.ts`: (1) `SN existente selecionada + ledger settled: retorna skipped sem chamar clients Conexos`, (2) `SN existente selecionada + ledger etapa='fin014-done': retoma na etapaNotaDebito sem re-baixar`. Cada um programa `repo.findByIdempotencyKey.mockResolvedValue({...})` e asserta ausência de `fin014.criarBordero` / `gerDoc.finalizarDocumento`. Tactic Bass: **Idempotent Replay** (cobertura).

- **Resultado Esperado**
  > Cobertura executável da promessa do ADR-0027. Métrica: 2 novos testes; 0 chamadas Conexos duplicadas no re-POST.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4, F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cenários retomada SN-existente cobertos: 0 → 2
- **Risco de não fazer**: Regressão futura pode re-executar baixa/NDe na retomada; visível só na reconciliação manual.
- **Dependências**: nenhuma

### [fault-tolerance-5] Sinal explícito de "SN reutilizada" no ledger e/ou log estruturado

- **Problema**
  > O ledger `solicitacao_numerario_execucao` guarda o `doc_cod` da SN mas não diferencia "gerada por nós" de "reutilizada pelo analista via ADR-0027". Auditoria de adoção da feature e investigação de incidentes ficam cegas.

- **Melhoria Proposta**
  > Preferencialmente: adicionar coluna `origem_sn TEXT CHECK (origem_sn IN ('gerada','reutilizada'))` no ledger + persistir no `beginExecution`. Alternativa leve (sem migração): emitir `logService.info({type: LOG_TYPE.BUSINESS_INFO, message: 'sn-existente-selecionada', data: {txnId, priCod, snDocCod, ator}})` na entrada do `processarAlocacao` quando `snSelecionadaDocCod !== undefined` — combinado com o `LogService` estruturado do handler, dá trilha grep-able. Tactic Bass: **Timestamp / audit trail**. Arquivos: `RecebimentoNumerarioService.ts:217-348` + migração opcional.

- **Resultado Esperado**
  > Query "quantas alocações usaram SN existente em X" respondível em 1 SQL ou `grep`. Métrica: sinal explícito presente em 100% das execuções do ramo SN-existente (hoje: 0%).

- **Tactic alvo**: Timestamp (audit trail)
- **Severidade**: P2
- **Esforço estimado**: S (log) / M (coluna + migração)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - % execuções ramo SN-existente com sinal explícito: 0% → 100%
- **Risco de não fazer**: Feedback loop cego sobre a adoção do ADR-0027; investigação de incidentes precisa inferir por join custoso.
- **Dependências**: opcional — coordenar com o card de audit trail cross-cutting (se existir) para reusar o mesmo shape.

## 6. Notas do agente

- Escopo restrito ao delta ADR-0027 (9 arquivos do `_shared-metrics.md`). Não auditei o resto do repo — as tactics herdadas (Timeout, Rollback do ledger, Handlers Lambda) foram marcadas como "herdadas" onde relevante mas não re-medidas.
- Métrica de duplicatas reais em produção não é medível localmente (requer CloudWatch); F-1/F-2 são baseados em análise estática do fluxo.
- Cross-QA para o consolidator: **F-fault-tolerance-2** (guard `vldStatus`) tem overlap com Integrability (validar o contrato do `com299/list` que devolve statuses mistos) e Testability (cenário faltante); **F-fault-tolerance-5** overlap com Security (auditability) — o `LogService` do handler é o hook natural.
- Known follow-up do prompt (*finalização de SN Aberta antes da baixa*) foi materializado como **[fault-tolerance-2]** — decisão do produto necessária entre "auto-finalizar", "fail-closed" e "filtrar na UI".
