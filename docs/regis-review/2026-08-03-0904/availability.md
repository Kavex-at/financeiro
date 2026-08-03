---
qa: Availability
qa_slug: availability
run_id: 2026-08-03-0904
agent: qa-availability
generated_at: 2026-08-03T09:04:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 3
---

# Availability — Regis-Review

> Escopo estrito: delta da branch `fix/sn-titulo-condicao-fail-closed` contra
> `fix/sn-cond-pgto-finalizacao` (worktree `C:/tmp/sn-titulo-wt`). O centro é
> `RecebimentoNumerarioService.completarSnAdiantamento` — agora `addLineItem` +
> `applyPaymentConditionIfRequired` + `requiresRegisteredPaymentCondition`. O contexto (Express
> em Render + Supabase; sem `infra/`, Lambda, SQS ou SSM) é premissa, não finding.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| ERP Conexos (com299 + com194) | `PUT com299` que troca `pgtCod` DESTRÓI as parcelas do documento (comportamento medido no HML doc 735) e a `com194` pode indicar exigência da condição sugerida por-pessoa (dado do tenant) | `RecebimentoNumerarioService.etapaSn` (caminho de escrita irreversível: gerar SN → completar → finalizar) | Operação normal, ERP acessível; sub-cenário: com194 degradado | (a) linha de item PRIMEIRO (preserva o título); (b) leitura best-effort da com194 → PUT da condição SÓ se `fdvVldErr===2` mencionando condição de pagamento; (c) releitura + sanity check `mnyTitValor === docMnyValor` (fail-closed nomeando causa); (d) com194 indisponível ⇒ segue SEM PUT (não perturbar documento íntegro) e delega ao próximo discriminador (finalização) | 0 SNs finalizadas com título destruído; retomada mid-completação ainda depende de intervenção manual (`com032`) — MTTR real não instrumentado |

Nota: o delta REMOVE um POST destrutivo do caminho feliz (o PUT deixou de ser incondicional), o
que baixa a probabilidade média de falha por escrita. O trade-off é a nova leitura síncrona da
com194 dentro da hot path da escrita.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas irreversíveis no caminho feliz da SN (após geração, antes de finalizar) | **2** (gerar + adicionar item) — antes: 3 (gerar + PUT condição + adicionar item) | minimizar | ✅ | `RecebimentoNumerarioService.ts:451-621` |
| Leituras síncronas na hot path da escrita (novas) | **1 nova** (`listValidacoes` da com194) + 1 releitura (`getDocumento` pós-PUT quando condicional dispara) | bounded (retry + timeout) | ⚠️ | `RecebimentoNumerarioService.ts:531-535, 503-507` |
| Sanity check pós-PUT (`mnyTitValor === docMnyValor`, `> 0`) | **presente**, com fail-closed nomeando causa | presente | ✅ | `RecebimentoNumerarioService.ts:508-518` |
| Condition Monitoring do validador antes da escrita irreversível | **presente**, best-effort com try/catch | presente | ✅ | `RecebimentoNumerarioService.ts:526-557` |
| Sub-etapas persistidas dentro de `completarSnAdiantamento` (checkpoints intra-etapa) | **0** (nenhum `setEtapa` entre `setDocCod` e `setEtapa('sn-finalizar')`) | ≥2 (após addLineItem, após verificação pós-PUT) | ❌ | `RecebimentoNumerarioService.ts:402-421` |
| Retry na leitura best-effort da com194 | **1 retry / 500 ms** (compartilhado do `runWithRetry` do `ConexosBaseClient`) | dedicado, mais curto | ⚠️ | `ConexosBaseClient.ts:211-216`; `ConexosNdeFiscalClient.ts:199` |
| Timeout HTTP do cliente Conexos que serve a com194 | **40 s** (compartilhado do `services/conexos.ts`) | ≤ 5 s p/ best-effort na hot path | ⚠️ | `src/backend/services/conexos.ts:121` |
| Stall máx. do caminho de escrita sob com194 degradada (best-effort) | ≈ `retries × timeout` = 2 × 40 s = **~80 s** por alocação, bounded | ≤ 5 s | ⚠️ | Composição das duas linhas acima |
| Cobertura de teste do fail-closed no discriminador pós-PUT | **presente** (mock releitura devolve `mnyTitValor:0`; expect `status==='error'`, `etapa==='sn'`, `finalizarDocumento` NÃO chamado) | presente | ✅ | `RecebimentoNumerarioService.test.ts:435-460` (bloco "FAIL-CLOSED: se o PUT destruir o título") |
| Cobertura de teste do path com194-indisponível | **presente** (`listValidacoes` mock rejeitado → `settled` sem PUT) | presente | ✅ | `RecebimentoNumerarioService.test.ts:462-471` |
| Cobertura de teste da ordem `item → validacoes → PUT` | **presente** (`invocationCallOrder` — item < validacoes < PUT) | presente | ✅ | `RecebimentoNumerarioService.test.ts:395-405` |
| Circuit breaker por-dependência (com194) | **ausente** — sem `PollExecutor`/`FallbackExecutor` no serviço | presente sob degradação sustentada | ❌ | `Grep RetryExecutor\|FallbackExecutor\|PollExecutor` em `RecebimentoNumerarioService.ts` → 0 usos diretos |
| Rollback / ação compensatória para SN em estado "docCod gravado + título destruído" | **ausente** — instrução operacional no `Error.message` ("Gere as parcelas na tela Financeiro (com032) do documento e reprocesse a alocação"), sem endpoint ou UI para reset/re-emissão | presente ou fluxo automatizado | ❌ | `RecebimentoNumerarioService.ts:511-517` |

⚠️ **Não medível localmente**: MTTR real da SN presa em "título destruído + docCod gravado". Requer
CloudWatch / equivalente em Render (métrica: tempo entre `markError(etapa='sn')` com mensagem
contendo "DESTRUIU os títulos" e o próximo `markSettled` do mesmo `idempotencyKey`).
Recomendação: instrumentar contador de ocorrências desse ramo do fail-closed e histograma de
tempo-até-reprocessamento por `idempotency_key`, expondo via `/health` ou logs estruturados.

⚠️ **Não medível localmente**: taxa de degradação da com194 em produção Columbia. Requer log
scrape dos `BUSINESS_WARN "com194 unavailable while checking the SN payment condition"`. Sem essa
série, o dimensionamento do timeout best-effort é palpite.

## 3. Tactics — Cobertura no nf-projects (delta em revisão)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Sem health-check contra o ERP Conexos ou com194 | ❌ ausente | (fora do delta; contexto Express/Render) |
| Heartbeat | N/A — trilha é request/response por alocação, sem processo long-running | N/A | — |
| Monitor | `LogService.warn/error` em cada ramo; sem CloudWatch (contexto Render) | ⚠️ parcial | `RecebimentoNumerarioService.ts:544-554, 1200-1210, 1259-1265` |
| Timestamp | N/A para este delta (o campo `docDtaEmissao` não muda) | N/A | — |
| Sanity Checking | **NOVO no delta**: releitura pós-PUT exige `mnyTitValor === docMnyValor` e `> 0` | ✅ presente | `RecebimentoNumerarioService.ts:503-518` |
| Condition Monitoring | **NOVO no delta**: consulta a com194 (`fdvVldErr===2` + regex `CONDICAO DE PAGAMENTO`) antes de aplicar o PUT | ✅ presente | `RecebimentoNumerarioService.ts:531-542` |
| Voting | N/A — fonte única (ERP Conexos) | N/A | — |
| Exception Detection | `assertNoErpError` em `validaGeracao`/`gerDocProcesso`/`finalizaDocumento`; erro nomeado no fail-closed do PUT; `try/catch` no best-effort da com194 | ✅ presente | `RecebimentoNumerarioService.ts:409, 415, 428, 511-517, 543` |
| Self-Test | N/A — sem endpoint de auto-teste da integração | N/A | — |
| Active Redundancy | N/A — sem réplica do ERP Conexos | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Try/catch no `requiresRegisteredPaymentCondition` (best-effort → false + warn) e `rodarEtapas` (catch global → `registrarFalha` → `markError`) | ✅ presente | `RecebimentoNumerarioService.ts:543-556, 386-388, 1307-1342` |
| Rollback | ❌ **ausente** — PUT do `pgtCod` é irreversível no ERP; nenhuma ação compensatória tentada quando o discriminador acusa destruição do título. Instrução no `Error.message` delega ao operador (`com032` manual) | ❌ ausente | `RecebimentoNumerarioService.ts:511-517` |
| Software Upgrade | N/A | N/A | — |
| Retry | Herdado do `ConexosBaseClient.runWithRetry` (1 retry / 500 ms) nas leituras; escritas irreversíveis usam `postGenericOnce` (correto — sem retry silencioso). Nenhum retry adicional no delta | ✅ presente (herdado) | `ConexosBaseClient.ts:216`; `ConexosNdeFiscalClient.ts:199` |
| Ignore Faulty Behavior | **NOVO no delta**: com194 indisponível ⇒ retorna `false` + log warn + segue sem PUT — decisão consciente e documentada ("never disturb an intact document; finalization is the next discriminator") | ✅ presente | `RecebimentoNumerarioService.ts:543-557` |
| Degradation | Passo da condição de pagamento é gracefully pulado quando não exigido; porém, quando o PUT destrói o título, a "degradação" vira exigência de intervenção manual sem queue de exceção equivalente à do SISPAG | ⚠️ parcial | `RecebimentoNumerarioService.ts:469, 510-518` |
| Reconfiguration | ❌ ausente — sem chave para "usar sequência antiga" ou "desligar o passo da condição" via env; toda mudança de comportamento requer deploy | ❌ ausente | (nenhuma feature flag no delta) |
| Shadow | N/A | N/A | — |
| State Resynchronization | **Parcial e novo**: releitura do documento pós-PUT resincroniza a decisão local com o estado do ERP; entretanto, o ledger `solicitacao_numerario_execucao` não persiste checkpoints DENTRO de `completarSnAdiantamento` — retomada assume que "docCod gravado ⇒ documento completo" | ⚠️ parcial | `RecebimentoNumerarioService.ts:503-507` (positivo); `RecebimentoNumerarioService.ts:402-421` (gap na retomada) |
| Escalating Restart | N/A — Express single-process no Render | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |
| Removal from Service | N/A no delta (sem componente para tirar de rota) | N/A | — |
| Transactions | ❌ **ausente** — sequência (`setDocCod` → `addLineItem` → `applyPaymentConditionIfRequired` → `setEtapa('sn-finalizar')`) não é atômica; qualquer falha entre `setDocCod` (linha 417) e `setEtapa('sn-finalizar')` (linha 429) deixa o documento em estado intermediário no ERP sem checkpoint local que force re-execução do sub-passo | ❌ ausente | `RecebimentoNumerarioService.ts:417-429` |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | **AMPLIFICADO no delta**: o PUT deixou de ser incondicional (evita a classe inteira de falhas "título destruído sem exigência real"); a linha de item vem antes (evita `docMnyValor` zerado pelo PUT); o próprio código é uma prevenção estrutural do bug medido no HML doc 735 | ✅ presente | ADR-0025 `ontology/decisions/0025-sn-condicao-pagamento-condicional-fail-closed.md:60-74` |
| Increase Competence Set | **AMPLIFICADO no delta**: o serviço aprendeu a lidar com duas fontes de variação — "cadastro exige/não exige condição sugerida" (por-pessoa) e "PUT destrói/não destrói parcelas" (divergência HML × produção). Documentado no ADR-0025 + banner "CICLO DE VIDA DO TÍTULO" em `integrations/conexos-com299-gerdoc.md` | ✅ presente | ADR-0025; `ontology/integrations/conexos-com299-gerdoc.md` (banner novo) |

## 4. Findings

### F-availability-1: Sub-etapas de `completarSnAdiantamento` não têm checkpoint no ledger — retomada pós-falha pula addLineItem/verificação silenciosamente

- **Severidade**: P1 (alto — degrada MTTR de forma medível; pré-existente mas amplificado pela nova complexidade da etapa)
- **Tactic violada**: State Resynchronization / Transactions
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:402-421` (bloco `if (snDocCod === undefined)`) e `451-454` (`completarSnAdiantamento`)
- **Evidência (objetiva)**:
  ```ts
  // linhas 416-421
  snDocCod = gen.docCod;
  await this.execucaoRepository.setDocCod(key, snDocCod);
  // O doc nasceu SHELL (docMnyValor:0). Completa o adiantamento ...
  await this.completarSnAdiantamento(ctx, snDocCod);
  }
  if (existente?.etapa === undefined || existente.etapa === 'sn') {
      // finalize
  ```
  Nenhum `setEtapa` intermediário é gravado entre `setDocCod` e `setEtapa('sn-finalizar')`. Se
  `completarSnAdiantamento` lança após `setDocCod`, a próxima execução entra em `etapaSn` com
  `snDocCod !== undefined` (pulando a completação inteira) e cai direto no `finalizarDocumento`.
- **Impacto técnico**: quatro cenários de falha mid-completação são todos irrecuperáveis pela
  retomada automática:
  1. `addLineItem` falha (5xx no `adicionarComDocProduto`) → retomada tenta finalizar SN sem
     item → ERP recusa; ledger volta a `error`, ciclo infinito.
  2. `requiresRegisteredPaymentCondition` falha internamente (o try/catch protege — não é o
     caso), mas se falhar de forma não capturada (ex.: `stripAccents` ou parse) → mesmo efeito.
  3. `atualizarDocumento` (PUT) falha após executar no ERP mas antes de a resposta chegar → SN
     com condição alterada, retomada tenta finalizar sem revisitar o discriminador.
  4. Discriminador dispara (`mnyTitValor !== docMnyValor`) → operador executa `com032`, mas a
     próxima re-execução PULA a verificação de coerência (não relê).
- **Impacto de negócio**: SN órfã presa exige intervenção manual do analista (com032 + DBA para
  destravar idempotency); MTTR depende do conhecimento operacional do analista, não da
  automação. Multiplica-se por alocação em splits com N processos.
- **Métrica de baseline**: 0 `setEtapa` intermediários entre linhas 417 e 429 do serviço
  (grep validado). 3 sub-etapas lógicas (`addLineItem`, `requiresRegisteredPaymentCondition`,
  `applyPaymentConditionIfRequired`) sem persistência.

### F-availability-2: Nova dependência síncrona (com194) no caminho da escrita sem breaker/timeout dedicado — stall bounded mas ≈80 s

- **Severidade**: P2 (débito técnico defensável — best-effort protege contra outage completo;
  degradação sustentada da com194 alonga o request)
- **Tactic violada**: Removal from Service (Prevent Faults) / Degradation
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:531-535`;
  cliente em `src/backend/domain/client/ConexosNdeFiscalClient.ts:199` (`runWithRetry`); timeout
  HTTP compartilhado em `src/backend/services/conexos.ts:121` (40 000 ms)
- **Evidência (objetiva)**:
  ```ts
  // linha 199 ConexosNdeFiscalClient.ts
  return await this.base.runWithRetry(async () => { ... });
  ```
  ```ts
  // linha 121 services/conexos.ts
  timeout: 40000,
  ```
  `runWithRetry` é 1 retry / 500 ms (`ConexosBaseClient.ts:211-216`). Pior caso: 2 tentativas ×
  40 s = ~80 s por alocação enquanto a com194 estiver pendurada, antes de degradar para "sem
  PUT". O request HTTP da rota `/recebimentos/.../processar` segura essa latência inteira.
- **Impacto técnico**: sob degradação da com194, uma execução paralela de M alocações consome
  M conexões do pool por até 80 s adicionais cada, aumentando o risco de exaustão de conexões
  Postgres/Supabase (o request é síncrono em Express).
- **Impacto de negócio**: alocações "processar" giram por até ~80 s a mais durante incidentes
  do validador; se o analista abandonar e clicar de novo, dobra a carga.
- **Métrica de baseline**: 1 nova chamada síncrona (`listValidacoes`) no caminho de escrita
  (grep confirma que era 0 na branch base); stall bounded ≈ retries × timeout = 2 × 40 s.

### F-availability-3: Fail-closed do discriminador pós-PUT depende de ação manual fora do sistema (`com032`) — sem endpoint/UI de recuperação

- **Severidade**: P2 (débito técnico defensável — o ADR-0025 documenta a decisão explícita;
  cenário raro em produção pela divergência HML × produção)
- **Tactic violada**: Rollback / Reconfiguration
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:510-518`
- **Evidência (objetiva)**:
  ```ts
  // linhas 510-518
  if (!(titulo > 0) || titulo !== valorDoc) {
      throw new Error(
          `A condição de pagamento "${cond.pgtDesNome}" ... o ERP DESTRUIU os títulos ...
          Gere as parcelas na tela Financeiro (com032) do documento e reprocesse a alocação.`,
      );
  }
  ```
  A recuperação requer: (1) o analista ler a mensagem no painel; (2) abrir o `com032` no ERP;
  (3) gerar as parcelas manualmente; (4) reprocessar. Não há endpoint automatizado, notificação
  ativa, nem re-emissão de SN com nova `idempotency_key`.
- **Impacto técnico**: a orquestração aceita um "poço" operacional — SN com docCod, com item,
  sem título, sem condição válida. Retomada não sai desse estado sem ação humana.
- **Impacto de negócio**: MTTR real é operator-limited. Se o divergência HML × produção
  (documentada no `open-gap` `divergencia-hml-producao-pgtCod`, P2) aparecer em produção
  Columbia, cada ocorrência trava a alocação até intervenção manual.
- **Métrica de baseline**: 0 endpoints/rotas para reset/re-emissão automatizada do estado
  bloqueado (verificado em `routes/recebimentos.ts`). Ação exigida está apenas em `Error.message`.

### F-availability-4: Warn best-effort da com194 não é correlacionado com a falha subsequente da finalização — dificulta RCA em degradações combinadas

- **Severidade**: P3 (hardening — o discriminador seguinte captura o erro, mas o operador vê
  dois sinais desconectados)
- **Tactic violada**: Exception Detection (parcial — sem correlation)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:543-556`
- **Evidência (objetiva)**:
  ```ts
  // linhas 544-554
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'com194 unavailable while checking the SN payment condition — proceeding WITHOUT
                touching it (never disturb an intact document); finalization is the next
                discriminator',
      data: { txnId: ctx.txnId, docCod: snDocCod, erro: ... },
  });
  return false;
  ```
  Cenário: com194 cai + cadastro EXIGE a condição → PUT não é aplicado → `finalizaDocumento`
  falha com "CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA" (mensagem legítima do ERP). Os dois
  eventos (warn + error) NÃO carregam um id de correlação compartilhado (o `key` `sn-real:...`
  não é anexado ao warn, só ao error final via `markError`).
- **Impacto técnico**: diagnóstico exige juntar dois logs por `txnId+docCod` manualmente.
- **Impacto de negócio**: aumenta o tempo de RCA em incidentes combinados; sem métrica.
- **Métrica de baseline**: `warn` inclui `txnId`+`docCod` mas não a `idempotency_key` `key`
  usada pelo `markError` (linha 1321), quebrando a correlação simples via chave.

## 5. Cards Kanban

### [availability-1] Persistir sub-etapas dentro de `completarSnAdiantamento` no ledger de execução

- **Problema**
  > A sequência `setDocCod → addLineItem → applyPaymentConditionIfRequired → setEtapa('sn-finalizar')`
  > não tem checkpoints intermediários. Falha entre `setDocCod` (linha 417) e
  > `setEtapa('sn-finalizar')` (linha 429) deixa a SN em estado intermediário no ERP; a retomada
  > entra com `snDocCod !== undefined` e PULA a completação inteira, chamando `finalizarDocumento`
  > num documento que pode estar sem item ou sem título. O bug do "gap dos títulos" (medido no
  > HML docs 731–735) já mostrou que estados intermediários no com299 são reais e caros.

- **Melhoria Proposta**
  > Estender o enum `SolicitacaoNumerarioEtapa` com marcadores intra-completação (ex.:
  > `sn-item-added`, `sn-condition-checked`) e chamar `setEtapa` após cada sub-passo do
  > `completarSnAdiantamento`. Na retomada, cada sub-método deve consultar o ledger e pular
  > apenas o que já foi confirmado — mesmo padrão que `etapaFin014`/`etapaFiscal` já usam
  > (`existente?.fin014BorCod !== undefined`). Tactic Bass: **State Resynchronization** +
  > **Transactions** (compensating checkpoints em ausência de 2PC no ERP).

- **Resultado Esperado**
  > Retomada mid-completação executa apenas o que faltou; falhas de rede transitórias no
  > `adicionarComDocProduto`/`atualizarDocumento` deixam de exigir intervenção manual.
  > Checkpoints intra-etapa: 0 → 2 (após addLineItem, após verificação pós-PUT).

- **Tactic alvo**: State Resynchronization
- **Severidade**: P1
- **Esforço estimado**: M (2–3 d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Checkpoints persistidos dentro de `completarSnAdiantamento`: 0 → 2
  - Testes cobrindo retomada após falha em `addLineItem` e em `applyPaymentConditionIfRequired`:
    0 → 2 (bloco novo em `RecebimentoNumerarioService.test.ts`)
- **Risco de não fazer**: qualquer erro transitório de rede/ERP entre `setDocCod` e
  `setEtapa('sn-finalizar')` cria SNs órfãs; cada uma exige DBA + `com032` para destravar.
  Multiplica em splits N-way.
- **Dependências**: nenhuma; o padrão já existe nas etapas `fin014`/`fiscal`.

### [availability-2] Isolar a leitura da com194 com timeout dedicado e política de retries mais curta

- **Problema**
  > `requiresRegisteredPaymentCondition` roda em série no caminho de escrita. Sob degradação da
  > com194, o pior caso é ~80 s (2 tentativas × timeout de 40 s do `services/conexos.ts:121`).
  > O request HTTP da rota `/processar` segura esse tempo inteiro, e M alocações paralelas
  > consomem M conexões pelo mesmo período — risco real de exaustão de pool sob incidente
  > sustentado do validador.

- **Melhoria Proposta**
  > Encapsular a chamada em um `PollExecutor`/`RetryExecutor` local com timeout ≤ 5 s por
  > tentativa e retries=1 (mesmo comportamento best-effort, latência bounded). Alternativa:
  > passar o timeout como parâmetro do `runWithRetry` no `ConexosBaseClient`. Manter o
  > try/catch com fallback para "sem PUT" — a decisão de degradar continua igual, o que muda é
  > o teto de latência. Tactic Bass: **Removal from Service** (parcial) / **Degradation
  > bounded**.

- **Resultado Esperado**
  > Stall máximo do caminho de escrita sob com194 degradada: ~80 s → ≤ 10 s por alocação.

- **Tactic alvo**: Degradation (bounded)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Timeout efetivo da chamada `listValidacoes` na hot path: 40 s → ≤ 5 s
  - Novo teste em `RecebimentoNumerarioService.test.ts` que faz o mock demorar > 5 s e valida
    que a etapa segue sem PUT em ≤ 10 s
- **Risco de não fazer**: incidente da com194 (mesmo curto) degrada o throughput de
  processamento durante o pico de recebimentos; sem métrica, o time descobre pelo cliente.
- **Dependências**: nenhuma.

### [availability-3] Endpoint operacional para reset/re-emissão da SN após regeneração manual das parcelas (com032)

- **Problema**
  > Quando o discriminador pós-PUT acusa título destruído (`RecebimentoNumerarioService.ts:510-518`),
  > a `Error.message` instrui o analista a executar `com032` no ERP e "reprocessar a alocação".
  > Mas ao reprocessar, `existente.docCod !== undefined` → `etapaSn` NÃO re-executa a
  > completação nem re-verifica a coerência do título, indo direto para `finalizarDocumento`.
  > A recuperação depende do analista lembrar de executar o `com032` primeiro; se ele
  > reprocessar antes, o ciclo repete. Não há endpoint dedicado ou UI para "confirmar
  > regeneração manual e forçar re-verificação".

- **Melhoria Proposta**
  > Adicionar um endpoint `POST /recebimentos/alocacoes/:key/reintroduzir` que: (a) valide que
  > o estado atual é `error` com mensagem específica (título destruído); (b) faça UMA releitura
  > do `com299/{docCod}` do ERP para confirmar que o título voltou; (c) só então libere a
  > retomada avançando para `sn-finalizar`. Registrar no ledger quem acionou e quando. Tactic
  > Bass: **State Resynchronization** + **Escalating Restart** (adaptado — não é reboot, é
  > "revalidar antes de continuar").

- **Resultado Esperado**
  > SN em estado "título destruído" tem caminho de recuperação nomeado e testável (não depende
  > de ordem operacional implícita).

- **Tactic alvo**: State Resynchronization / Rollback (compensating)
- **Severidade**: P2
- **Esforço estimado**: M (2–4 d) — endpoint + teste + UI mínima ou CLI
- **Findings relacionados**: F-availability-3, F-availability-1
- **Métricas de sucesso**:
  - Endpoints para recuperação automática da SN presa: 0 → 1
  - Teste E2E de recuperação após simular título destruído + regeneração no ERP fake: 0 → 1
- **Risco de não fazer**: se a divergência HML × produção (open-gap `divergencia-hml-producao-pgtCod`)
  ocorrer em algum cliente Columbia, cada incidente vira ticket manual sem SLA claro.
- **Dependências**: [availability-1] (checkpoints intra-etapa) — sem eles o endpoint precisa
  duplicar lógica de "onde estamos".

## 6. Notas do agente

- Score 7/10: o delta é fortemente aditivo para availability — introduz Sanity Checking +
  Condition Monitoring onde não havia; **remove um POST irreversível do caminho feliz**;
  e amplifica Exception Prevention estruturalmente. Deduções por gap de retomada
  intra-etapa (pré-existente mas agora mais provável), ausência de circuit breaker/timeout
  dedicado para a nova dependência, e ausência de rollback automatizado — todos documentados
  como aceitos no ADR-0025.
- Métricas de MTTR real e taxa de degradação da com194 marcadas como não-medíveis: exigem
  observabilidade em produção que este stack (Express/Render) ainda não tem instrumentada.
- Cross-QA: F-availability-2 tem interseção com **performance** (latência do endpoint
  `/processar` sob degradação de dependência); F-availability-1 tem interseção com
  **fault-tolerance** (retomada idempotente). Ambos avisados ao consolidator.
- Fora de escopo por --quick: sem coverage, sem terraform (não existe), sem npm audit.
