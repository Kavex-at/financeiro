---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-03-0904
agent: qa-fault-tolerance
generated_at: 2026-08-03T09:04:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 5
---

# Fault Tolerance — Regis-Review

> Escopo: delta `fix/sn-cond-pgto-finalizacao..HEAD` (worktree `C:/tmp/sn-titulo-wt`), flag `--quick`.
> Centro: `RecebimentoNumerarioService.ts` — sequência de escritas REAIS no com299 (adiantamento de
> cliente). Não há `infra/`/Terraform (Express + Render, ver CLAUDE.md); tactics de AWS ausentes NÃO
> são avaliadas. "Safety" (Bass) foi substituído por **state consistency under partial failure**.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Processar" numa alocação de recebimento | Processo Node/Express morre (ou a rede tomba, ou o ERP devolve HTTP 200 enganoso) no meio da sequência de escritas no com299 — entre a geração da SN, a linha de item, o PUT da condição de pagamento, a verificação do título e a finalização | `RecebimentoNumerarioService.processarAlocacao` (SN com299 → fin014 → NDe com297 → cauda fiscal) | Produção normal, `conexosWriteEnabled=true`, `conexosDryRun=false`, escritas irreversíveis pela API do Conexos, HML e produção com comportamentos DIVERGENTES no efeito do PUT da condição | Nenhuma escrita duplicada no ERP (nenhuma SN gerada duas vezes, nenhum título baixado duas vezes no fin014, nenhuma NDe emitida duas vezes na SEFAZ); documento inconsistente NÃO é finalizado (fail-closed com causa nomeada); ledger local reflete a etapa parada (`markError`) para retomada/diagnóstico | 0 documentos com299 finalizados sem título; 0 baixas fin014 duplicadas por retomada; 100% das falhas por etapa registradas no ledger com etapa e mensagem interpretada; discriminador `mnyTitValor === docMnyValor` avaliado toda vez que o PUT da condição roda |

Contexto crítico do delta: as medições em `docs/e2e/gap-titulos-diagnostico.md` mostraram que o
comportamento do ERP no PUT da condição de pagamento DIVERGE entre HML (destrói as parcelas) e produção
(preserva). O delta responde com fail-closed + verificação — assumir nenhum dos dois comportamentos.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotency key por escrita financeira | `sn-real:{txnId}:{priCod}:{valor}` (repository ledger; write-ahead + retomada) | Presente em 100% dos handlers de escrita financeira | ✅ | `RecebimentoNumerarioService.ts:241` |
| Retomada por `etapa` (checkpointing) | 9 etapas ordenadas (`sn`, `sn-finalizar`, `fin014`, `fin014-done`, `nota-debito`, `fiscal-done`, `obs-done`, `homologado`, `concluido`) | Uma etapa por escrita externa não-idempotente | ⚠️ Gap entre `setDocCod` e `sn-finalizar` (item + condição + verificação num único bloco não checkpointado) | `ports.ts:393-403` + `RecebimentoNumerarioService.ts:392-432` |
| Fail-closed em ERP `messages[].valid==='ERRO'` | `assertNoErpError` chamado após cada `validarGeracao`, `gerarDocProcesso`, `finalizarDocumento` | 100% dos POSTs que devolvem `messages` | ✅ | `RecebimentoNumerarioService.ts:1369-1375` (helper), chamado em `:409, :415, :428, :1008, :1097` |
| Discriminador de consistência pós-PUT da condição | `mnyTitValor === docMnyValor` (>0) na releitura | Discriminador por etapa que detecte TODA divergência PUT→título (destruição, valor mudou, parcelas fragmentadas) | ⚠️ Detecta destruição (`mnyTitValor==0`) e mismatch simples; não detecta edição concorrente na Conexos que altere ambos coerentemente | `RecebimentoNumerarioService.ts:500-519` |
| Verificação pós-finalização (`docVldFinalizado===1`) | Ausente — só `assertNoErpError(finMsgs, 'finalizaDocumento')` | Releitura + `docVldFinalizado===1` (contrato explícito no ADR-0025 e na ação `gerar-solicitacao-numerario.md`) | ⚠️ Contrato documentado no ADR não é enforçado no código; a fail-closed vem uma etapa depois (fin014 não acha título) | `RecebimentoNumerarioService.ts:423-429` (chamada); ADR-0025 diz "finalização ⟺ docVldFinalizado === 1 na releitura" |
| Best-effort no leitor da com194 | `requiresRegisteredPaymentCondition` → catch-all → `return false` | Discriminar transporte (401/403/404/405 = bug de integração) de indisponibilidade retryable (5xx/timeout) — mesmo padrão do `classifyValidatorError` do pré-flight | ❌ Delta engole TODA classe de erro no mesmo return, mascarando auth expirado / rota errada | `RecebimentoNumerarioService.ts:526-557` |
| Tests cobrindo o fluxo condicional + verificação | 6 novos casos (aplica sob validação bloqueante; ordem item→val→PUT; ignora aviso de outro assunto; ignora aviso não-bloqueante; fail-closed título destruído; com194 indisponível não bloqueia) | Cobertura completa dos modos de decisão + degradação; retomada intra-etapa-sn | ⚠️ Modos de decisão cobertos; retomada mid-completion (crash entre `setDocCod` e finalize) NÃO tem teste | `RecebimentoNumerarioService.test.ts:369-459` (novos); `test.ts:863-919` (retomada só a partir de `fin014-done`/`obs-done`) |
| Suíte central | 97 suites / 1017 verdes; typecheck limpo | 100% verde | ✅ | `_shared-metrics.md` |
| Anti-duplicação (mesma alocação repetida) | `checarBloqueio` retorna `settled` se ledger `status==='settled'`; HALT em `reconciling` órfão sem `docCod` | Nenhum re-POST de uma alocação já executada | ✅ | `RecebimentoNumerarioService.ts:1345-1367` |

> ⚠️ **Não medível localmente**: comportamento do PUT da condição em produção × HML. Requer instrumentação
> de contadores dedicados no fluxo real (Conexos prod × Conexos HML) — a divergência está documentada em
> `docs/e2e/gap-titulos-diagnostico.md` sem métrica ao vivo.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Substitution** (Avoid Faults) | Passo do PUT condicional substitui a versão incondicional que destruía o título no HML | ✅ presente | `RecebimentoNumerarioService.ts:462-519` + ADR-0025 |
| **Replacement** | N/A (não há redundância de ERP; Conexos é única fonte) | N/A | — |
| **Predictive Model** | `requiresRegisteredPaymentCondition` prediz se o PUT é necessário via com194 antes de tentá-lo | ✅ presente | `RecebimentoNumerarioService.ts:526-557` |
| **Increase Competence Set** | Pré-flight `classificarAlocacao` (gates 0-3) amplia os modos de falha reconhecidos (transporte × cadastro × elegibilidade); `escolherCondicaoPagamento` casa por token (estrito + truncado) para não escolher condição de terceiro | ✅ presente | `RecebimentoNumerarioService.ts:838-965` + `:654-722` |
| **Sanity Checking** | Discriminador `mnyTitValor === docMnyValor` na releitura pós-PUT | ⚠️ parcial — detecta destruição, mas não a finalização (`docVldFinalizado===1` não é lida) nem edições concorrentes coerentes | `RecebimentoNumerarioService.ts:500-519` (presente); ausente para `docVldFinalizado` após `finalizarDocumento` (`:423-429`) |
| **Comparison** | N/A (não há réplicas para comparar; a "comparação" que existe é título × valor do próprio doc) | N/A | — |
| **Timestamp** | Ledger `criadoEm`/`atualizadoEm` + `emitidaEm` na NDe local | ✅ presente | `ports.ts:429-430`; `RecebimentoNumerarioService.ts:1228` |
| **Timeout** | Herdado do `ConexosClient` (não medível no delta) — o delta não introduz nenhum `setTimeout` manual | ✅ presente (fora do delta) | Fora do escopo `--quick` |
| **Condition Monitoring** | Ledger reflete a etapa alcançada (`setEtapa`); `revisaoHumana` e `ndeAutorizado` como flags separados de settle | ⚠️ parcial — etapas grossas: entre `setDocCod` e `sn-finalizar` cabem 3 escritas (item + PUT opcional + releitura); crash no meio deixa o ledger sem checkpoint intermediário | `RecebimentoNumerarioService.ts:392-432` (única janela) + `ports.ts:393-403` (enum) |
| **Self-Test** | O próprio serviço se auto-testa via releitura pós-PUT | ✅ presente (só no PUT da condição) | `RecebimentoNumerarioService.ts:503-518` |
| **Voting** | N/A | N/A | — |
| **Redundancy** | N/A (não há réplica de execução; a redundância aqui seria backpressure para reprocesso — não avaliado no delta) | N/A | — |
| **Recovery — Rollback** | N/A por natureza da API Conexos: escritas são irreversíveis. Escolha explícita = forward recovery | N/A justificado | ADR-0025 §Consequências ("exige ação manual do analista na `com032`") |
| **Recovery — Repair State** | `checarBloqueio` + retomada por etapa recompõe estado a partir do ledger | ✅ presente (grosso) | `RecebimentoNumerarioService.ts:335-389` |
| **Reintroduction — Shadow / State Resync / Escalating Restart** | N/A (não há shadow deployment; ledger + etapa fazem state-resync) | N/A | — |
| **Idempotent Replay** | Idempotency key por `(txnId,priCod,valor)`; retomada evita re-POST em `fin014-done`/`nota-debito`/`fiscal-done`/`obs-done`/`homologado` | ✅ presente para etapas grossas; ⚠️ parcial dentro da etapa `sn` (delta expandiu o bloco não checkpointado com item + PUT + verificação) | `RecebimentoNumerarioService.ts:241, 322-330, 1048, 1111, 1133, 1160` |
| **Compensating Transaction** | Deliberadamente ausente — o Conexos não aceita undo. Forward recovery = fail-closed + instrução ao analista | ✅ política explícita (não é omissão) | ADR-0025 §Alternativas ("Manter o PUT incondicional e implementar a regeneração das parcelas via tela `com032`: rejeitado") |
| **Reconcile** | Não há reconciliação periódica ERP × ledger (silent-divergence detector). O ndeAutorizado é reconciliado sob demanda (re-alocação retoma poll) | ⚠️ parcial — reativo, não proativo | `RecebimentoNumerarioService.ts:1246-1267` |
| **Quarantine** | Ledger `status='error'` com etapa + `erroMensagem` funciona como fila de exceção (ainda não há Lambda de DLQ→exception queue porque não existe SQS) | ⚠️ parcial (adequado ao estado atual Express/Render) | `RecebimentoNumerarioService.ts:1307-1342` |

## 4. Findings (achados)

### F-fault-tolerance-1: Janela de retomada não checkpointada entre `setDocCod` e a finalização deixa o documento SN em estado indeterminado

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring, Idempotent Replay
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:392-432`
- **Evidência (objetiva)**:
  ```ts
  // etapaSn — o bloco de completação está DENTRO do guard `snDocCod === undefined`
  if (snDocCod === undefined) {
      ...
      snDocCod = gen.docCod;
      await this.execucaoRepository.setDocCod(key, snDocCod);            // ← ledger avança AQUI
      await this.completarSnAdiantamento(ctx, snDocCod);                 // ← item + PUT opcional + verificação
  }
  if (existente?.etapa === undefined || existente.etapa === 'sn') {
      const finMsgs = await this.gerDocClient.finalizarDocumento({...}); // ← única checkpoint depois
      ...
      await this.execucaoRepository.setEtapa(key, 'sn-finalizar');
  }
  ```
  O `setDocCod` grava o `docCod` no ledger. Se o processo morrer entre essa linha e o fim de
  `completarSnAdiantamento` (crash, kill do Render, exceção de rede na `addLineItem`, `atualizarDocumento`
  ou no GET de verificação), a retomada entra com `snDocCod !== undefined` e **pula o bloco inteiro** —
  o item nunca é adicionado, a condição nunca é (re)avaliada e a releitura verificadora é ignorada.
  O `finalizarDocumento` roda em seguida sobre um documento incompleto/inconsistente.
- **Impacto técnico**: documento SN persistido no ERP com item ausente OU parcelas destruídas, sem que
  qualquer etapa consiga "curar" o doc: cada retomada re-fira `finalizarDocumento`, que falha, marca
  `error` no ledger e sai. O único caminho de recuperação é intervenção manual na tela `com032`
  (documentada no ADR-0025 como forward-recovery), mas o ledger não distingue "morri no item" de "morri
  na condição" — a etapa registrada é sempre `sn`. A cobertura de teste existente para retomada só
  exercita `fin014-done`/`obs-done` (`test.ts:863-919`).
- **Impacto de negócio**: para cada crash mid-completion, um documento com299 fica órfão no Conexos até
  ser resolvido manualmente pelo analista. Sem discriminador de sub-etapa, o operador não sabe qual
  correção manual aplicar (adicionar item? refazer condição? gerar parcelas?). A automação promete
  fail-closed com "causa nomeada"; nesta janela específica o nome da causa é perdido.
- **Métrica de baseline**: 3 escritas irreversíveis (`comDocProdutos`, `atualizarDocumento`,
  `getDocumento` para verificação) executadas dentro de 0 checkpoints intermediários no ledger; 0 testes
  de retomada intra-etapa-sn na suíte do delta.

### F-fault-tolerance-2: Leitor da com194 (`requiresRegisteredPaymentCondition`) mascara erros de transporte como "não exige condição"

- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Increase Competence Set (detecção de fault de integração)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:526-557`
- **Evidência (objetiva)**:
  ```ts
  } catch (cause) {
      await this.logService.warn({...});
      return false;   // ← qualquer erro → "não exige condição"
  }
  ```
  O catch é indiscriminado. 401 (token expirado), 403 (permissão removida), 404/405 (rota errada) e um
  5xx/timeout genuíno caem todos no mesmo `return false`. O próprio serviço já provou, no pré-flight,
  que essa mistura é perigosa: `classifyValidatorError` (`:805-825`) foi introduzido exatamente porque um
  405 mascarado de "inelegibilidade" escondeu um bug de rota. O leitor da com194 no delta repete o
  anti-padrão.
- **Impacto técnico**: com auth expirado, a automação decide silenciosamente que o PUT não é necessário e
  segue para a finalização. Se o cadastro do cliente EXIGIR a condição, o ERP recusará a finalização com
  "CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA" — fail-closed acontece, mas na etapa errada e sem
  apontar para o problema real de integração. Em produção (pessoa 194, cadastro exige "L-FOUNDERS -
  DUPLICATA"), esse cenário é o modo de falha esperado.
- **Impacto de negócio**: um problema operacional único (renovar token) vira um encadeamento de falhas
  atribuídas a "condição de pagamento", pulverizando o diagnóstico entre alocações e analistas.
- **Métrica de baseline**: 4 classes de status HTTP (401/403/404/405) tratadas como "sem pendência" em
  vez de "HALT — bug de integração"; 0 verificações do tipo do erro antes do return.

### F-fault-tolerance-3: Discriminador do PUT da condição não é enforçado pós-`finalizarDocumento` (contrato do ADR não é código)

- **Severidade**: P2
- **Tactic violada**: Sanity Checking
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:423-429`
  (chamada) vs contrato em `ontology/actions/recebimentos/gerar-solicitacao-numerario.md` (postcondition
  `real → SN … gerada E finalizada`) e ADR-0025 ("finalização ⟺ `docVldFinalizado === 1` na releitura")
- **Evidência (objetiva)**:
  ```ts
  const finMsgs = await this.gerDocClient.finalizarDocumento({...});
  this.assertNoErpError(finMsgs, 'finalizaDocumento');
  await this.execucaoRepository.setEtapa(key, 'sn-finalizar');
  // ← nenhuma releitura de docVldFinalizado
  ```
  O ADR-0025 e o `integrations/conexos-com299-gerdoc.md` deixam claro que a doutrina é "HTTP 200 nunca
  é sucesso" — cada etapa precisa de um discriminador próprio. O delta implementa esse discriminador para
  o PUT da condição (bem feito), mas NÃO para o próprio `finalizarDocumento`. A fail-closed acontece uma
  etapa depois no fin014 (`listTitulosBorderoReceber` vazio → erro), o que funciona mas atribui a falha
  à etapa errada e desperdiça uma escrita de borderô no ERP.
- **Impacto técnico**: um cenário raro em que o ERP devolve 200 com `messages` sem ERRO, mas
  `docVldFinalizado===0` (por exemplo, um AVISO que degrada a finalização) só é detectado no fin014.
  O borderô é criado (escrita real!) e depois o fluxo aborta.
- **Impacto de negócio**: borderô órfão no fin014 para cada finalização silenciosamente incompleta;
  atribuição de causa errada no ledger.
- **Métrica de baseline**: 1 asserção só sobre `messages[].valid==='ERRO'` na finalização; 0 asserções
  sobre `docVldFinalizado===1` (contrato explícito).

### F-fault-tolerance-4: Divergência HML × produção no PUT destrutivo não tem sinal proativo — o gap com032 nunca dispara

- **Severidade**: P1
- **Tactic violada**: Reconcile / Condition Monitoring
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:510-519`
  (fail-closed local); `ontology/integrations/conexos-com299-gerdoc.md` (banner "CICLO DE VIDA DO
  TÍTULO", open-gap `regeneracao-parcelas-com032`); `docs/e2e/gap-titulos-diagnostico.md`
- **Evidência (objetiva)**:
  ```ts
  if (!(titulo > 0) || titulo !== valorDoc) {
      throw new Error(...);   // ← fail-closed local; instrução para o analista
  }
  ```
  O ADR-0025 deixa explícito: "revisitar se um cliente real cair no caso bloqueante — é o único cenário
  em que o PUT volta a rodar de verdade". Mas o código não distingue este erro de qualquer outro
  `markError` — ele é registrado com a mesma severidade que "conta contábil não encontrada" ou "com297
  gerDocProcesso ERRO". Não há contador, tag, correlation-id específico ou fanout que permita ao time
  ver "aconteceu N vezes em produção com PUT destrutivo → hora de implementar a regeneração via com032".
  A decisão de forward-recovery está registrada, mas o sinal que a dispara não existe.
- **Impacto técnico**: se o comportamento de produção mudar (uma condição de parcelamento nova, uma
  migração do Conexos, um cliente novo) e o PUT começar a destruir parcelas, a única evidência será nos
  logs individuais de `markError`. Sem métrica agregada, a descoberta é anedótica.
- **Impacto de negócio**: risco escondido de silent-divergence entre HML e produção. Quando o modo
  bloqueante aparecer, ele aparecerá como "reclamações do analista" antes de virar um sinal de
  engenharia — atraso na priorização do backlog (`regeneracao-parcelas-com032`, P2 hoje).
- **Métrica de baseline**: 0 métricas dedicadas ao caso "condição aplicada + título destruído"; 1
  mensagem de erro genérica que mistura este caso com todos os outros erros da etapa `sn`.

### F-fault-tolerance-5: Discriminador `mnyTitValor === docMnyValor` não cobre edição concorrente / decomposição coerente das parcelas

- **Severidade**: P3
- **Tactic violada**: Sanity Checking (cobertura incompleta)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:500-519`
- **Evidência (objetiva)**:
  ```ts
  const titulo = round2(Number(depois.mnyTitValor ?? 0));
  const valorDoc = round2(Number(depois.docMnyValor ?? 0));
  if (!(titulo > 0) || titulo !== valorDoc) {  // ← falha se destruído; passa se ambos ≠ ctx.valor
      throw new Error(...);
  }
  ```
  Casos não cobertos:
  (a) analista abre o mesmo doc na tela Conexos e edita concorrentemente — `docMnyValor` e `mnyTitValor`
  podem terminar iguais entre si mas diferentes do `ctx.valor` que originou a alocação;
  (b) o PUT decompõe o título em N parcelas somando o mesmo valor — passa a checagem, mas o fin014
  precisa saber lidar com múltiplos títulos (o código pega `titulos[0]` em `:994`, o resto seria
  ignorado).
- **Impacto técnico**: baixo — o caso (a) exige concorrência (analista tocando durante o processamento
  automático), o caso (b) exige que o PUT REGENERE parcelas (não observado nem em HML nem em produção).
- **Impacto de negócio**: baixo. Vale como P3 documentado para não voltar a esta discussão daqui a 6
  meses sem contexto.
- **Métrica de baseline**: discriminador cobre 1 de 3 modos de degradação plausíveis do PUT
  (destruição — o único observado).

## 5. Cards Kanban

### [fault-tolerance-1] Checkpointar sub-etapas do `etapaSn` para tornar a retomada mid-completion determinística

- **Problema**
  > A janela entre `setDocCod` e `setEtapa(key,'sn-finalizar')` executa 3 escritas irreversíveis no ERP
  > (linha de item + PUT condicional da condição + releitura verificadora) sem gravar checkpoints
  > intermediários no ledger. Se o processo morrer nessa janela, a retomada assume que a completação
  > terminou (só olha `snDocCod`) e dispara `finalizarDocumento` num documento incompleto. O fail-closed
  > acontece no fin014, atribuindo a causa à etapa errada; um documento com299 fica órfão no Conexos até
  > intervenção manual, e o ledger não diz onde o crash ocorreu.

- **Melhoria Proposta**
  > Introduzir duas etapas intermediárias em `SolicitacaoNumerarioEtapa` (`sn-item-added`,
  > `sn-cond-verified`) e chamar `setEtapa` após cada escrita bem sucedida de `addLineItem`,
  > `atualizarDocumento` e da verificação `mnyTitValor === docMnyValor`. Ajustar
  > `etapaSn`/`completarSnAdiantamento` para pular pelos passos já registrados na retomada — mesmo
  > princípio já usado para `fiscal-done`/`obs-done`. Tactic Bass: **Condition Monitoring** +
  > **Idempotent Replay**. Arquivos: `ports.ts:393-403`,
  > `RecebimentoNumerarioService.ts:392-519`, `RecebimentoNumerarioService.test.ts` (adicionar suite
  > "retomada mid-completion" com 3 casos: crash após item, crash após PUT, crash após verificação).

- **Resultado Esperado**
  > Ledger sempre reflete a última escrita ERP bem sucedida no com299. Retomada é determinística: uma
  > alocação retomada após crash retoma da última sub-etapa gravada, sem re-POST e sem pular escritas
  > pendentes. Documento com299 órfão vira exceção rara auditável (etapa exata), não regra silenciosa.

- **Tactic alvo**: Condition Monitoring, Idempotent Replay
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Checkpoints intermediários no bloco de completação: 0 → 3
  - Testes de retomada intra-etapa-sn na suíte do serviço: 0 → 3
  - Documentos com299 "órfãos" (item ausente / PUT parcial) por retomada: passa a ser identificável no
    ledger (etapa != `sn` genérico)

### [fault-tolerance-2] Aplicar `classifyValidatorError` no leitor da com194 (não engolir transporte)

- **Problema**
  > `requiresRegisteredPaymentCondition` faz `catch (cause) → return false` sem discriminar o tipo do
  > erro. 401/403 (auth expirado) e 404/405 (rota errada) passam a ser tratados como "não exige
  > condição", mesmo comportamento de um 5xx transitório. O próprio serviço demonstra, no pré-flight
  > (`classifyValidatorError:805`), por que essa mistura é perigosa: um 405 mascarado já escondeu um bug
  > de rota. Repetir o anti-padrão no delta trai o próprio precedente do arquivo.

- **Melhoria Proposta**
  > Reaproveitar `classifyValidatorError` (ou uma variante boolean): em 401/403/404/405, propagar o erro
  > com mensagem explícita ("com194 auth/rota falhou — não classifiquei elegibilidade da condição"),
  > forçando fail-closed na etapa `sn` com a causa CORRETA. Só timeout/5xx/payload inesperado degrada
  > para `return false` (a hipótese conservadora original). Tactic Bass: **Sanity Checking** e
  > **Increase Competence Set**. Arquivo: `RecebimentoNumerarioService.ts:526-557`.

- **Resultado Esperado**
  > Bug de integração aparece imediatamente e atribuído ao componente certo. O modo "com194 fora do ar
  > mas cadastro do cliente exige condição" só se aplica ao caso transitório real, não a auth expirado.

- **Tactic alvo**: Sanity Checking, Increase Competence Set
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Classes de erro que causam `return false`: 5 (todas) → 2 (só timeout/5xx)
  - Cobertura de testes: adicionar 2 casos (401 → throw; 500 → return false)
  - Falhas de finalização mal-atribuídas a "condição diferente" quando a causa real é auth: alvo 0

### [fault-tolerance-3] Reler `docVldFinalizado === 1` após `finalizarDocumento` (contrato do ADR-0025 vira código)

- **Problema**
  > O ADR-0025 e a ação `gerar-solicitacao-numerario.md` explicitam que finalização ⟺
  > `docVldFinalizado === 1` na releitura. O código só chama `assertNoErpError` nas `messages`. Um
  > cenário em que o ERP devolve 200 com AVISO (não ERRO) mas `docVldFinalizado===0` só é detectado no
  > `etapaFin014` (título vazio em `lov/TituloBorderoReceber`), depois de já ter criado o borderô — uma
  > escrita real desperdiçada. O discriminador por-etapa é a doutrina explícita da leg fiscal
  > (`integrations/conexos-nde-fiscal.md`) e o delta a aplica ao PUT da condição, mas não à finalização.

- **Melhoria Proposta**
  > Após `finalizarDocumento`, chamar `getDocumento` e exigir `docVldFinalizado === 1` (throw com a mesma
  > estrutura de erro do fail-closed do PUT — nome da etapa `sn`, mensagem interpretável ao analista).
  > Tactic Bass: **Sanity Checking**. Arquivo: `RecebimentoNumerarioService.ts:423-429`. Teste:
  > adicionar caso "finalizarDocumento retorna 200 sem ERRO mas docVldFinalizado===0 → status error na
  > etapa sn, sem criar borderô".

- **Resultado Esperado**
  > A finalização bem sucedida do com299 é enforçada pelo mesmo padrão discriminador das outras
  > escritas; nenhuma tentativa de baixa fin014 sobre documento não-finalizado.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Discriminador `docVldFinalizado===1` presente: não → sim
  - Borderôs órfãos por finalização mal-detectada: passa a ser 0 (evitados antes da criação)
  - Cobertura de teste: +1 caso "AVISO + docVldFinalizado===0"

### [fault-tolerance-4] Instrumentar contador dedicado do "caso bloqueante com PUT destrutivo" (gatilho do backlog `regeneracao-parcelas-com032`)

- **Problema**
  > O ADR-0025 explicitou que a implementação de regeneração via tela `com032` só vale se um cliente
  > real cair no caso "condição aplicada + título destruído". Mas o código registra essa falha com a
  > mesma severidade e schema que qualquer outro `markError` na etapa `sn`. Sem métrica dedicada, o
  > sinal para reabrir o gap `regeneracao-parcelas-com032` fica invisível — a descoberta seria
  > anedótica, via analista reclamando. A divergência HML × produção documentada em
  > `gap-titulos-diagnostico.md` fica sem alerta.

- **Melhoria Proposta**
  > Criar um tipo de erro dedicado (`SnPaymentConditionDestroyedTitleError` ou subclasse de
  > `NumerarioGapError`) que o `applyPaymentConditionIfRequired` throwa quando o discriminador falha,
  > e um `LOG_TYPE` distinto na chamada `logService.error` do `registrarFalha`. Adicionar métrica no
  > painel (contagem por dia por filial). Se houver > 0 em produção por > N dias, o gap
  > `regeneracao-parcelas-com032` sai de P2 para P0 automaticamente (regra de escalonamento
  > documentada). Tactic Bass: **Reconcile** / **Condition Monitoring**. Arquivos:
  > `RecebimentoNumerarioService.ts:510-519`, `errors/NumerarioGapError.ts`, `LogService`.

- **Resultado Esperado**
  > Sinal ao vivo de que o modo bloqueante com PUT destrutivo apareceu em produção. Priorização do
  > backlog `regeneracao-parcelas-com032` fica baseada em evidência, não em anedota.

- **Tactic alvo**: Reconcile, Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Tipo de erro dedicado: 0 → 1
  - Contador ativo em produção: 0 → 1
  - Latência de descoberta do modo bloqueante: "quando o analista notar" → "no fim do dia"

### [fault-tolerance-5] Ampliar o discriminador título↔documento para pegar edição concorrente e decomposição em múltiplas parcelas

- **Problema**
  > `mnyTitValor === docMnyValor` (>0) detecta destruição, mas passa em dois casos que podem aparecer no
  > futuro: (a) edição concorrente pelo analista na tela Conexos altera ambos coerentemente, resultando
  > num doc coerente mas com valor diferente do `ctx.valor` alocado; (b) o PUT decompõe em N parcelas
  > (não observado hoje) — a soma bate mas o `etapaFin014` usa apenas `titulos[0]`.

- **Melhoria Proposta**
  > (a) Adicionar `titulo === ctx.valor` à comparação (ancorar no valor de origem da alocação, não só na
  > coerência interna do doc). (b) Adicionar `assertion(titulos.length === 1)` no `etapaFin014:994` ou
  > iterar sobre todos os títulos. Tactic Bass: **Sanity Checking**. Arquivos:
  > `RecebimentoNumerarioService.ts:500-519` e `:990-1000`. Teste: adicionar 2 casos (mnyTitValor
  > coerente ≠ ctx.valor; múltiplos títulos no LOV).

- **Resultado Esperado**
  > Discriminador cobre 3 de 3 modos de degradação plausíveis (destruição, mismatch com origem,
  > decomposição). Nenhum modo silencioso possível de PUT vs alocação.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Modos de PUT-corrompe-doc cobertos pelo discriminador: 1 → 3
  - Cobertura de teste: +2 casos

## 6. Notas do agente

- Escopo `--quick` respeitado: só olhei o delta do worktree, o serviço central, seus testes e as
  ADRs/ontology tocadas. Fora do escopo: idempotência das outras rotas, transações Postgres do
  `SolicitacaoNumerarioExecucaoRepository` (não medível sem ler a implementação do repo Postgres, que o
  delta não toca), reprocesso end-to-end via SQS/EventBridge (não há infra AWS neste repo — CLAUDE.md).
- A escolha explícita de **forward recovery** (Conexos não aceita undo; fail-closed + instrução ao
  analista) é registrada no ADR-0025 e vale como resposta às tactics de Rollback/Compensating
  Transaction — marquei como `N/A justificado`, não como gap.
- Cross-QA: **Testability** — a suíte cobre bem os modos DE DECISÃO do PUT condicional, mas não a
  RETOMADA intra-etapa-sn (F-fault-tolerance-1). **Availability** — o mesmo checkpointing granular do
  card 1 melhora o tempo de recuperação e a diagnose de incidentes; o card 2 do best-effort com194
  também é uma detecção de fault de integração relevante para availability. **Security** — o card 4
  toca em auditoria (log dedicado para o caso bloqueante) e overlapa com a discussão de audit trail /
  quem-quando-o-quê da execução financeira.
