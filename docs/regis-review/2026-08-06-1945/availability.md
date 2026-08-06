---
qa: Availability
qa_slug: availability
run_id: 2026-08-06-1945
agent: qa-availability
generated_at: 2026-08-06T19:45:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Availability — Regis-Review

> Escopo: gate pós-impl do `/feature-tweak` **bordero-vazio-orfao** (I-Write-7). Revisão restrita ao
> delta: `removerBorderoOrfao` + `isBaixaConfirmada` em `ReconciliacaoPermutaService`,
> `assertBorderoTemItens` em `BorderoGestaoService`, guard de UI em `BorderosPanel.tsx`, ADR-0030 e a
> nova invariante I-Write-7 em `fin010-write-contract.md`. Nada do repo fora disso foi (re)avaliado.

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista dispara **Baixar** (`reconciliar`) numa permuta cujo par adto→invoice falha em TODAS as alocações no handshake `fin010` (passos 2–5). | O `POST /api/fin010` (passo 1) sucedeu → `borCod` criado no ERP; os `gravarBaixaPermuta` seguintes falharam (ex.: `Generic.ERROR_MESSAGE`, timeout, HTTP 500). | Borderô órfão no `fin010` (casco vazio) + linha `error` na trilha `permuta_alocacao_execucao` com `bor_cod` preenchido. | Produção, escrita habilitada (`CONEXOS_WRITE_ENABLED=true`), Conexos operacional para leitura. | Ao fim do loop, o serviço detecta ausência de qualquer alocação `settled`, valida no ERP via `listBaixas` que o borderô está vazio e o remove (`excluirBordero`). Se o ERP relata item ou a exclusão falha, degrada para WARN sem perder o erro real da baixa. `finalizarBordero` recusa aprovar borderô sem item ANTES do POST; UI espelha desabilitando "Aprovar". | Zero cascos novos após o merge (fluxo produtor + consumidor); erro real da baixa 100% preservado no `resultados[i].erro`; regressão do borderô **18538** coberta por testes (4 novos em `ReconciliacaoPermutaService.test.ts`, 2 em `BorderoGestaoService.test.ts`). |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas ERP extras no caminho FELIZ da reconciliação | 0 | 0 | ✅ | `ReconciliacaoPermutaService.ts:291` — o `removerBorderoOrfao` só entra quando `!resultados.some(isBaixaConfirmada)`; no caminho feliz o predicado é falso. |
| Chamadas ERP extras no caminho de FALHA TOTAL da reconciliação | 2 (`listBaixas` + `excluirBordero`) | ≤ 2 | ✅ | `ReconciliacaoPermutaService.ts:317-326` |
| Chamadas ERP extras por `finalizarBordero` (Aprovar) | 1 (`listBaixas`) | ≤ 1 | ✅ | `BorderoGestaoService.ts:205` (guard antes do `POST fin010/finalizar`) |
| Testes cobrindo o novo predicado + fail-safe | 6/6 verde | 100% | ✅ | `_shared-metrics.md` (`ReconciliacaoPermutaService.test.ts:504-580`, `BorderoGestaoService.test.ts:376-404`) |
| Retry policy nas novas chamadas (`listBaixas`) | 2 retries, 500 ms, jitter 200 ms | herança do executor compartilhado | ✅ | `ConexosBaseClient.ts:154-163` + `ConexosBaixaClient.ts:156` (`runWithRetry` em `listBaixas`) |
| Retry policy no `excluirBordero` (compensação) | Tentativa única | Idempotente no ERP → 1 tentativa é aceitável | ✅ | `ConexosBaixaClient.ts:225-234` — DELETE simples, sem `runWithRetry` |
| Timeout HTTP herdado (Conexos legacy) | 40 000 ms | ≤ 60 000 ms | ✅ | `src/backend/services/conexos.ts:121` (`timeout: 40000`) |
| Guard-rail dry-run/write-enabled preservado no delta | mantido | inalterado | ✅ | `ReconciliacaoPermutaService.ts:136-141` (não tocado pelo tweak) |
| Backend `npm test` das suites permutas | 47/47 ✅ | 100% | ✅ | `_shared-metrics.md` |
| Alarme/dashboard agregando `BUSINESS_WARN` por borderô órfão em produção | ausente | ≥ 1 alarme | ⚠️ | Requer CloudWatch/Grafana em produção — repo não tem `infra/` (ver CLAUDE.md), stack roda em Render. |
| MTTR real de indisponibilidade do ERP no `finalizarBordero` (fail-closed) | não medido | — | ⚠️ | Requer observabilidade em produção; hoje o único sinal é o erro que sobe pro toast do front. |

> ⚠️ **Não medível localmente**: taxa de nascimento de cascos em produção (antes vs. depois do
> merge). Requer contagem de `BUSINESS_WARN "borderô órfão (vazio) removido..."` em logs de produção +
> contagem de borderôs `EM_CADASTRO` com `listBaixas=[]` na Conexos. Recomendação: instrumentar
> métrica `permuta.bordero_orfao_removido_total` e `permuta.bordero_orfao_deteccao_falhou_total`
> (contadores por `filCod`) — hoje só existem os `logService.info/warn` estruturados.

> ⚠️ **Não medível localmente**: latência p95 adicional do `finalizarBordero` pela nova chamada
> `listBaixas`. O delta agrega no mínimo 1 round-trip HTTP síncrono ao ERP + a retry policy (2×500ms
> +jitter no pior caso). Só medível em homologação com o ERP real.

## 3. Tactics — Cobertura no delta

Todas as tactics canônicas de Availability (Bass & Clements, 3ª ed.). N/A justificado onde a tactic é
irrelevante para um tweak de 62 LoC de compensação + guard de escrita síncrona.

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não introduzido pelo delta. | N/A | Fluxo é síncrono, request/response com o ERP. |
| Heartbeat | Não aplicável — não há processo de background introduzido pelo delta. | N/A | — |
| Monitor | Falha de `excluirBordero` na compensação é registrada como `BUSINESS_WARN` estruturado; falha da baixa original é `BUSINESS_WARN` + `execucao.markError`. Nenhum alarme agregado (repo sem `infra/`). | ⚠️ parcial | `ReconciliacaoPermutaService.ts:334-343`, `:271-275` |
| Timestamp | Não introduzido pelo delta. A trilha já registra `atualizado_em` (pré-existente). | N/A | — |
| Sanity Checking | `listBaixas.length > 0` no ERP é a checagem antes de apagar (fail-safe contra apagar borderô com baixa real que entrou parcialmente). No consumidor, `assertBorderoTemItens` valida o inverso: só aprova se há item. Predicado adicional `isBaixaConfirmada` filtra `settled` e ignora `error/dry-run/skipped`. | ✅ presente | `ReconciliacaoPermutaService.ts:40`, `:317-325`; `BorderoGestaoService.ts:264-272` |
| Condition Monitoring | O predicado "borderô nasceu nesta chamada && zero `settled`" é uma condição monitorada no fim de `reconciliar`. | ✅ presente | `ReconciliacaoPermutaService.ts:146`, `:291` |
| Voting | N/A — não há réplicas para votar. | N/A | ERP é single-source. |
| Exception Detection | `try/catch` explícito no `removerBorderoOrfao` (limpeza best-effort) e catch já existente no loop de alocações capturando falha por par. | ✅ presente | `ReconciliacaoPermutaService.ts:316-343`, `:264-283` |
| Self-Test | N/A — não há self-test executado pelo delta. | N/A | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — ERP único, não há standby ativo. | N/A | — |
| Passive Redundancy | N/A — idem. | N/A | — |
| Spare | N/A. | N/A | — |
| Exception Handling | Catch da compensação NUNCA re-lança: vira `BUSINESS_WARN` e o `reconciliar` retorna com o erro real da baixa intacto em `resultados[i].erro`. Testado. | ✅ presente | `ReconciliacaoPermutaService.ts:333-343`; teste `ReconciliacaoPermutaService.test.ts:565-580` |
| Rollback | `removerBorderoOrfao` é rollback compensatório da criação do borderô (passo 1 do handshake não é transacional com os passos 2–5). Sem transação BD/ERP possível — o contrato do `fin010` não a expõe. | ✅ presente | `ReconciliacaoPermutaService.ts:310-344`; ADR-0030 "Alternativas descartadas" |
| Software Upgrade | N/A. | N/A | — |
| Retry | `listBaixas` herda `runWithRetry` do `ConexosBaseClient` (2 retries, 500 ms, jitter 200 ms, `shouldRetry` filtra 4xx determinístico). `excluirBordero` sem retry — DELETE idempotente + a compensação é best-effort, retentar teria custo sem valor. `assertBorderoTemItens` herda o retry do `listBaixas`. | ✅ presente | `ConexosBaseClient.ts:154-163`; `ConexosBaixaClient.ts:156` (listBaixas), `:225-234` (excluirBordero) |
| Ignore Faulty Behavior | Falha do `excluirBordero` na compensação é deliberadamente ignorada pelo caminho principal (só WARN). Justificativa em ADR-0030 ("a limpeza é higiene, não a operação"). Testado. | ✅ presente | `ReconciliacaoPermutaService.ts:333-343`; ADR-0030 §"Por que a limpeza é best-effort" |
| Degradation | Quando a compensação falha, o painel oferece o botão "Excluir" manual (não regride). Quando o consumidor recusa aprovação vazia, a UI mostra o motivo e sugere "Excluir". | ✅ presente | `BorderosPanel.tsx:471-486` (tooltip "Borderô sem baixa — não há o que aprovar. Use 'Excluir'.") |
| Reconfiguration | N/A — não há reconfiguração no delta. | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A. | N/A | — |
| State Resynchronization | Após excluir com sucesso, `deleteBorderoCache(filCod, borCod)` sincroniza o cache local `permuta_bordero` com o ERP na hora — sem esperar o próximo refresh (evita mostrar borderô fantasma). | ✅ presente | `ReconciliacaoPermutaService.ts:327` |
| Escalating Restart | N/A. | N/A | — |
| Non-Stop Forwarding | N/A. | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | UI desabilita o botão "Aprovar" quando `!b.baixas.some(x => x.status === 'settled')` — remove a ação inválida do menu antes do usuário poder disparar. | ✅ presente | `BorderosPanel.tsx:471`, `:477-486` |
| Transactions | Não há transação de escrita entre passos 1 e 2–5 do `fin010` (limitação do ERP). A compensação simula rollback (ver Rollback). | ⚠️ parcial | ADR-0030 §"Alternativas descartadas" — criação lazy é inviável (passo 2 exige `borCod`). |
| Predictive Model | N/A — não há predição de falha do ERP no delta. | N/A | — |
| Exception Prevention | `assertBorderoTemItens` recusa a aprovação vazia ANTES do POST — impede o `Generic.ERROR_MESSAGE` "ESTE BORDERÔ NÃO POSSUI ITENS" que o ERP dispararia depois. Fonte da contagem = ERP (`listBaixas`), não a trilha (a trilha guarda `error` com `bor_cod`, contaria como cheio). | ✅ presente | `BorderoGestaoService.ts:205`, `:258-272`; teste `BorderoGestaoService.test.ts:391-404` |
| Increase Competence Set | Aloca o casco de borderô como parte do domínio conhecido (I-Write-7 na ontologia); o sistema reconhece um estado que antes só o ERP rejeitava tardiamente. | ✅ presente | `ontology/business-rules/fin010-write-contract.md:105-122`; `ontology/decisions/0030-bordero-orfao-e-aprovacao-vazia.md` |

## 4. Findings (achados)

### F-availability-1: `assertBorderoTemItens` fail-closed depende de leitura ao vivo do ERP a cada Aprovar

- **Severidade**: P2 (débito defensável — o trade-off fail-closed é correto para escrita financeira; a exposição não é P0/P1 porque a ação Aprovar já dependia de um POST síncrono ao ERP)
- **Tactic violada**: — nenhuma tactic violada; trade-off explícito entre **Exception Prevention** (implementada) e **Availability** do fluxo de aprovar (uma leitura extra que fail-closed com o ERP indisponível)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:200-217` (finalizarBordero) e `:264-272` (assertBorderoTemItens)
- **Evidência (objetiva)**:
  ```typescript
  public finalizarBordero = async (params) => {
      const filCod = await this.guardAcaoBordero(params.borCod);
      await this.assertBorderoTemItens(filCod, params.borCod); // ← nova chamada ao ERP (listBaixas)
      await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod });
      // ...
  };

  private assertBorderoTemItens = async (filCod: number, borCod: number): Promise<void> => {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length === 0) {
          throw new Error(`Borderô ${borCod} não possui baixas — ...`);
      }
  };
  ```
- **Impacto técnico**: se o ERP estiver com latência alta ou intermitentemente indisponível na hora
  do Aprovar, a nova chamada `listBaixas` (com retry 2× 500 ms +jitter) pode adicionar até ~1,4 s ao
  caminho no pior caso e, se falhar de vez, o Aprovar aborta com uma exceção do próprio `listBaixas`
  ANTES de tentar o `finalizarBordero` (que provavelmente também falharia). Não há fallback
  degradado — é fail-closed por design.
- **Impacto de negócio**: analista vê "falha ao aprovar" quando o ERP tosse, mesmo em borderôs que
  poderiam ser aprovados. Aceitável dado que a alternativa (aprovar sem checar) reproduz o cenário do
  borderô 18538 em produção. Zero risco financeiro; degrada UX do Aprovar em incidente de ERP.
- **Métrica de baseline**: 1 chamada síncrona nova por Aprovar, retry compartilhado 2×500ms+jitter,
  timeout HTTP herdado 40 000 ms (`services/conexos.ts:121`). Latência real p95 não medível fora de
  produção.

### F-availability-2: sem alarme/dashboard agregando `BUSINESS_WARN` da compensação

- **Severidade**: P2
- **Tactic violada**: **Monitor** (parcial — logs estruturados existem, agregação/alarme não)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:319-343`
- **Evidência (objetiva)**:
  ```typescript
  await this.logService.warn({
      type: LOG_TYPE.BUSINESS_WARN,
      message: 'falha ao remover o borderô órfão (best-effort) — remover pelo painel',
      data: { adiantamentoDocCod, borCod, erro: ... },
  });
  ```
  Os dois pontos de WARN da compensação (linha 319 = "ERP relata item, não removido"; linha 334 =
  "falha ao excluir") são escritos no log estruturado, mas não há agregador/alarme configurado
  (repo não tem `infra/` — ver CLAUDE.md "Estado Atual vs. Alvo": stack roda em Render/Supabase, sem
  CloudWatch/Grafana provisionado).
- **Impacto técnico**: cascos que a compensação não conseguiu limpar (ex.: período contábil fechado,
  timeout) acumulam silenciosamente até um analista notar no painel. A defesa do consumidor
  (`assertBorderoTemItens`) impede a aprovação vazia, mas não sinaliza operacionalmente.
- **Impacto de negócio**: zero risco financeiro imediato (o consumidor recusa aprovar), mas o time
  perde o sinal de tendência: "a taxa de nascimento de cascos está subindo?". Sem esse sinal, uma
  regressão em `gravarBaixaPermuta` (ex.: novo tipo de erro do ERP) só aparece no painel dias depois.
- **Métrica de baseline**: 0 alarmes agregando `BUSINESS_WARN` de permuta em produção hoje.

### F-availability-3: UI usa trilha local para decidir "Aprovar", pode dessincronizar do backend

- **Severidade**: P3
- **Tactic violada**: **Removal from Service** (parcial — o guard existe mas se apoia em fonte
  diferente do backend)
- **Localização**: `src/frontend/app/permutas/BorderosPanel.tsx:471`, `:477`
- **Evidência (objetiva)**:
  ```tsx
  const vazio = !b.baixas.some((x) => x.status === 'settled')
  // ...
  disabled={!noso || b.situacao !== 'EM_CADASTRO' || vazio}
  ```
  `b.baixas` vem da trilha local (via `BorderoGestaoService.listarBorderos`), enquanto o guard
  server-side (`assertBorderoTemItens`) consulta o ERP. Nos casos raros de trilha stale (ex.: a
  trilha foi purgada mas o borderô com baixa `settled` persiste no ERP), a UI desabilita "Aprovar"
  para um borderô que o backend aceitaria.
- **Impacto técnico**: falso-negativo do botão. O caminho inverso (UI habilita quando não deveria)
  não ocorre — `settled` na trilha implica baixa persistida com `bxaCodSeq`.
- **Impacto de negócio**: analista precisa recorrer a `/permutas/borderos` diretamente (paths de
  navegação já existentes); em produção normal isso não ocorre porque o cache de borderô +
  `listarBorderos` mantém a trilha alinhada.
- **Métrica de baseline**: teste `BorderoGestaoService.test.ts:105-127` cobre o caso "mostra borderô
  CANCELADO mesmo SEM trilha local" — a trilha vazia com borderô no cache é um caso conhecido.

### F-availability-4: caminho de falha total dobra o custo do incidente (baixa falha + limpeza retenta)

- **Severidade**: P3
- **Tactic violada**: nenhuma — sinalização de custo, não de gap
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:291-293`,
  `:317` (`listBaixas` no retry executor)
- **Evidência (objetiva)**: quando TODAS as baixas falham (cenário raro), o `reconciliar` faz:
  1. o loop já executou N tentativas com retry para cada `gravarBaixaPermuta`,
  2. depois entra em `removerBorderoOrfao` que chama `listBaixas` (com retry 2×500ms+jitter — via
     `runWithRetry`) + `excluirBordero` (single-shot).
  Se o ERP está fora do ar de vez, cada uma dessas chamadas gasta 40s de timeout HTTP × 3 tentativas
  no pior caso do `listBaixas` = até ~120s a mais no caminho de falha.
- **Impacto técnico**: latência do endpoint de reconciliação no cenário "ERP down" cresce.
- **Impacto de negócio**: o request do analista demora mais para retornar o erro; sem risco de
  escrita ou de estado inconsistente, apenas UX pior num incidente de infraestrutura do ERP.
- **Métrica de baseline**: pior caso teórico + 2×(40s×3 retries) na falha total; caminho feliz e
  falha parcial (`error → settled`) **não pagam esse custo** (a compensação não roda).

## 5. Cards Kanban

### [availability-1] Documentar o trade-off fail-closed do `assertBorderoTemItens` e instrumentar métrica de indisponibilidade

- **Problema**
  > O `finalizarBordero` agora depende de um `listBaixas` síncrono ao ERP antes de aprovar. É a
  > escolha certa (evita aprovar borderô fantasma como o 18538), mas o comportamento em incidente do
  > ERP não está documentado como decisão consciente nem monitorado — o analista só vê "falha ao
  > aprovar" no toast, sem distinguir "borderô vazio" de "ERP fora do ar".

- **Melhoria Proposta**
  > Adicionar comentário JSDoc explícito em `assertBorderoTemItens` marcando o fail-closed como
  > política (Bass tactic: **Exception Prevention** > Availability trade-off). No `route` que expõe
  > o endpoint, distinguir a exceção do próprio `listBaixas` (ex.: `ConexosError`) da recusa
  > semântica ("Borderô ... não possui baixas") — retornar mensagens diferentes para o front, e
  > incrementar um contador estruturado no `logService` (`permuta.assert_bordero_itens.erp_down`)
  > para observabilidade futura. Nenhuma mudança de comportamento.

- **Resultado Esperado**
  > Analista distingue os dois cenários no toast (mensagem diferente). Time consegue tracer a
  > frequência do fail-closed via log estruturado. Nenhum aumento de custo no caminho feliz.

- **Tactic alvo**: Monitor + Exception Prevention (formalizar trade-off documentado)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Diferenciação de mensagem de erro no route de `finalizarBordero`: 0 → 2 caminhos distintos
  - Log estruturado com contador do fail-closed: ausente → 1 novo `LOG_TYPE.BUSINESS_WARN` por
    incidente de `listBaixas` na guarda
- **Risco de não fazer**: se o ERP começar a intermitir, o time culpará o guard novo por regressões
  que na verdade são do ERP. Sinal ruído-x-real fica embaralhado.
- **Dependências**: —

### [availability-2] Rastrear taxa de compensação de borderô órfão em produção

- **Problema**
  > A compensação (`removerBorderoOrfao`) é a defesa de linha 1 contra o casco 18538. Ela loga
  > `BUSINESS_INFO`/`BUSINESS_WARN` estruturado, mas não há dashboard/alarme agregando esses eventos
  > — o time não sabe (a) quantas vezes por dia a compensação disparou, (b) quantas vezes ela falhou
  > e deixou o casco para o consumidor bloquear. Um pico silencioso indicaria regressão em
  > `gravarBaixaPermuta`.

- **Melhoria Proposta**
  > Instrumentar dois contadores estruturados no `LogService` com chaves padronizadas para
  > extração posterior:
  > - `permuta.bordero_orfao.removido` (INFO) — sucesso da compensação;
  > - `permuta.bordero_orfao.limpeza_falhou` (WARN) — compensação abortou (ERP relatou item OU
  >   `excluirBordero` lançou).
  >
  > Quando o repo ganhar `infra/` (roadmap `AwsInfraArchitect`), converter em métrica CloudWatch com
  > alarme sobre `limpeza_falhou > 0` num intervalo de 15 min. Enquanto isso, expor no painel de
  > diagnóstico existente (se houver) ou registrar como follow-up de observabilidade.

- **Resultado Esperado**
  > O time consegue responder "a taxa de nascimento de cascos está subindo?" em minutos, sem varrer
  > logs. Cascos que a compensação não conseguiu limpar viram um sinal ativo, não passivo.

- **Tactic alvo**: Monitor
- **Severidade**: P2
- **Esforço estimado**: S (log tag estruturado); M (dashboard/alarme após `infra/`)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Contadores estruturados existentes: 0 → 2
  - Alarme de `limpeza_falhou` (quando `infra/` existir): 0 → 1
- **Risco de não fazer**: regressão em `gravarBaixaPermuta` pode ficar semanas sem detecção, com
  cascos aparecendo no painel como "sujeira do dia-a-dia".
- **Dependências**: parcialmente atrelado ao card do QA `deployability` sobre observabilidade
  agregada (o `qa-consolidator` deve cross-referenciar).

### [availability-3] Alinhar a fonte-da-verdade do botão "Aprovar" com o guard server-side

- **Problema**
  > Frontend decide habilitar "Aprovar" olhando a trilha local (`b.baixas.some(status ===
  > 'settled')`). Backend decide olhando o ERP (`listBaixas`). Nos casos raros de trilha stale, a UI
  > pode desabilitar um botão que o backend aceitaria (falso-negativo). Não é grave hoje porque
  > `listarBorderos` mantém trilha e cache alinhados, mas cria uma inconsistência conceitual (duas
  > fontes-da-verdade decidindo a mesma coisa por caminhos diferentes).

- **Melhoria Proposta**
  > Expor um flag `podeAprovar: boolean` calculado no `BorderoGestaoService.listarBorderos` a
  > partir do mesmo predicado usado pelo `assertBorderoTemItens` (contagem no ERP via cache
  > `vlrTotalLiquido>0` OU baixa `settled` na trilha, o que casa com a semântica do backend).
  > Frontend consome esse flag em vez de recalcular. Um único ponto de decisão.

- **Resultado Esperado**
  > `BorderosPanel.tsx` usa `b.podeAprovar` em vez do predicado local `vazio`. Divergência
  > front-back cai a zero. Nenhum request extra ao ERP no `listarBorderos` (a informação já vem do
  > cache + trilha).

- **Tactic alvo**: Removal from Service (fonte única do predicado)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Duplicação de predicado front vs. back: 2 → 1
  - Divergência do botão em teste de trilha stale: alcançável → impossível
- **Risco de não fazer**: baixo em produção (o alinhamento se mantém pelo cache), mas cria débito
  cognitivo — um dev futuro pode mudar um lado e esquecer o outro.
- **Dependências**: —

### [availability-4] Circuit-breaker leve para a compensação em cenário de ERP degradado

- **Problema**
  > Quando o ERP está completamente indisponível, o `reconciliar` no caminho de falha total
  > primeiro exaure retries em cada `gravarBaixaPermuta` e depois entra em `removerBorderoOrfao`,
  > que faz um `listBaixas` também retentado (2 retries × 500 ms + jitter, timeout HTTP 40 s) e um
  > `excluirBordero`. No pior caso, o request do analista fica pendurado por dezenas de segundos
  > antes de retornar o erro real da baixa.

- **Melhoria Proposta**
  > No `removerBorderoOrfao`, se o erro que trouxe o loop de alocações a esse ponto **já** indica
  > indisponibilidade da rede/ERP (timeout, ECONNRESET, 5xx repetido), pular a compensação com um
  > WARN "compensação adiada — ERP indisponível". A compensação segue como best-effort no próximo
  > `reconciliar` do mesmo adto (o predicado `borderoCriadoAqui` já é local; o próximo run
  > detectaria via `existente.status='reconciling' com bor_cod` — F-availability já existente no
  > shared context). Alternativa mais simples: passar `signal: AbortController` com timeout
  > agregado de 5 s para o par `listBaixas + excluirBordero` — o que passar disso, ignora.

- **Resultado Esperado**
  > Em incidente de ERP, o request do analista devolve o erro real da baixa em ≤ 60 s (não em
  > ≤ 120 s + margem). O casco fica no ERP e será limpo no próximo run com ERP saudável ou
  > manualmente pelo painel; a UI espelha corretamente (guard consumidor + botão desabilitado).

- **Tactic alvo**: Degradation + Retry (com teto de custo)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Tempo pior caso do `reconciliar` em cenário "ERP down": ~120 s + margem → ≤ 60 s (via
    AbortController de 5 s na compensação)
  - Cascos criados no incidente: mesmos que hoje (compensação adiada, não removida)
- **Risco de não fazer**: baixo — o cenário é raro (ERP totalmente fora do ar por >40 s durante uma
  reconciliação) e o casco fica coberto pelo consumidor. Card é polimento.
- **Dependências**: —

## 6. Notas do agente

- **Escopo respeitado**: nenhuma finding fora do delta (removerBorderoOrfao / isBaixaConfirmada /
  assertBorderoTemItens / guard de UI / ADR-0030 / I-Write-7). O contrato de 5-POST do fin010 é
  pré-existente e não foi (re)avaliado; a retry policy do `ConexosBaseClient` é herdada e serve de
  baseline, não de finding.
- **P0/P1 explicitamente rebaixados**: considerei P1 para F-availability-1 (nova dependência
  síncrona no path de aprovar) e F-availability-2 (falta de alarme), mas nenhuma tem número de
  baseline defensável (`_shared-metrics.md` não tem métrica de indisponibilidade do ERP, e o repo
  não tem `infra/` para instrumentar). Regra do prompt: sem baseline numérico → P2. Cumpri.
- **Cross-QA detectado**:
  - `qa-fault-tolerance`: divide o mesmo território (compensação, in-doubt, idempotência). O card
    `availability-1` (mensagem diferenciada no route) provavelmente aparece lá também.
  - `qa-deployability`/`qa-testability`: card `availability-2` depende de observabilidade agregada,
    hoje ausente pela falta de `infra/` (declarada em CLAUDE.md).
- **Métricas não coletadas**: latência p95 do novo `listBaixas`; taxa histórica de nascimento de
  cascos (só há evidência do borderô 18538 como caso-origem — 1 ocorrência, insuficiente para
  baseline estatístico).
- **Confiança na avaliação do delta**: alta. O delta é 62 LoC de compensação + 18 LoC de guard + 10
  LoC de UI, todos com testes verdes (6/6 no shared-metrics), e a decisão de best-effort/fail-safe
  está documentada em ADR-0030 com justificativas técnicas (I-Write-3 compartilhado, trilha com
  `error+bor_cod` inflaria contagem).
