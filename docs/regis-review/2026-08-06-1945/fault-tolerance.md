---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-08-06-1945
agent: qa-fault-tolerance
generated_at: 2026-08-06T19:45:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| `ReconciliacaoPermutaService.reconciliar` (write-back `fin010`) | `POST /fin010` cria o borderô no passo 1, e **todas** as chamadas de `gravarBaixaPermuta` seguintes falham (500, timeout, `Generic.ERROR_MESSAGE`) | Borderô no ERP + linhas `reconciling`/`error` na trilha + cache local (`permuta_bordero`) | Escrita habilitada (`CONEXOS_WRITE_ENABLED=true`, `CONEXOS_DRY_RUN=false`) — produção | Compensação: apagar o casco no ERP + cache; recusar aprovação vazia no consumidor; erro real da baixa preservado para o analista | 0 borderôs órfãos aprovados (ERP rejeitaria de qualquer forma); 0 baixas reais apagadas por engano (guard `listBaixas>0`); erro original NUNCA mascarado pela limpeza (best-effort) |

Cenário-origem (produção): borderô **18538** (2026-08-06) — `POST /fin010/finalizar/18538` recusado com `"ESTE BORDERÔ NÃO POSSUI ITENS."`. O texto do ERP diz o que aconteceu mas não o que fazer. O delta fecha o produtor (limpeza) e o consumidor (recusa antecipada) do casco.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes cobrindo I-Write-7 (delta) | 6 novos (4 produtor + 2 consumidor) | ≥1 por caminho (feliz, misto, ERP-com-item, falha-da-limpeza, aprovação-vazia-ERP, aprovação-com-trilha-error) | ✅ | `_shared-metrics.md`; `ReconciliacaoPermutaService.test.ts:504-580`; `BorderoGestaoService.test.ts:376-404` |
| Suites permutas (`ReconciliacaoPermutaService` + `BorderoGestaoService`) | 47/47 pass | 100% | ✅ | `_shared-metrics.md` |
| Guarda "criado aqui" na limpeza (predicado) | `borderoCriadoAqui && borCod!==undefined && !resultados.some(isBaixaConfirmada)` | precisa das 3 condições | ✅ | `ReconciliacaoPermutaService.ts:291` |
| Guarda "ERP é a verdade" (fail-safe da limpeza) | `listBaixas>0 → não apaga` | presente | ✅ | `ReconciliacaoPermutaService.ts:317-325` |
| Fonte da verdade da contagem de itens em `assertBorderoTemItens` | `listBaixas` (ERP), NÃO trilha local | ERP | ✅ | `BorderoGestaoService.ts:264-272`; ADR-0030 §"Por que a contagem vem do ERP" |
| Ordem das operações em `removerBorderoOrfao` | ERP `excluirBordero` → cache `deleteBorderoCache` → log `info` | ERP primeiro (fonte da verdade); cache é derivado | ✅ (ordem) / ⚠️ (falha parcial) | `ReconciliacaoPermutaService.ts:326-332` |
| Timeout explícito nas chamadas ao ERP feitas na limpeza (`listBaixas`, `excluirBordero`) | Não medível localmente | Timeout no `ConexosBaixaClient` (herdado do axios) | ⚠️ Não medível localmente | Requer inspeção de `ConexosBaixaClient` + config de axios (fora do delta) |
| Testes da falha `deleteBorderoCache` (ERP apaga, cache não) | 0 | ≥1 | ⚠️ | `ReconciliacaoPermutaService.test.ts` (busca por `deleteBorderoCache` — só em happy-path) |
| Impacto no caminho feliz da aprovação | +1 chamada ao ERP (`listBaixas`) por `finalizarBordero` | documentado (ADR-0030 §Consequências) | ⚠️ trade-off aceito | `BorderoGestaoService.ts:205`; ADR-0030 |

> ⚠️ **Não medível localmente**: latência real da chamada extra `listBaixas` no `finalizarBordero`; comportamento REAL do `fin010/moduleBordero.delete` quando o borderô tem itens (o padrão do `excluirBordero` de alto nível no serviço enumera-e-apaga baixa a baixa antes, sugerindo que o endpoint NÃO cascateia — a inspeção fica para produção/HAR).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | (a) `assertBorderoTemItens` recusa aprovação vazia antes do POST; (b) `listBaixas>0` bloqueia a exclusão do casco quando o ERP disser que há item | ✅ presente | `BorderoGestaoService.ts:264-272`; `ReconciliacaoPermutaService.ts:317-325` |
| Comparison | Confronta o `resultados` local (nada `settled`) com o `listBaixas` do ERP antes de apagar — decisão final baseada no ERP, não na contagem local | ✅ presente | `ReconciliacaoPermutaService.ts:291-293, 317-325` |
| Condition Monitoring | Log `BUSINESS_WARN` quando o ERP relata item ou quando a exclusão falha; `BUSINESS_INFO` quando a limpeza ocorre com sucesso | ✅ presente | `ReconciliacaoPermutaService.ts:319-343` |
| Timeout | Delegado ao `ConexosBaixaClient` (axios). Não medível localmente; a limpeza NÃO adiciona timeout explícito próprio | ⚠️ parcial | `ReconciliacaoPermutaService.ts:317, 326` |
| Compensating Transaction | `removerBorderoOrfao` compensa o passo 1 do handshake (criação do borderô) quando o restante do handshake falhou totalmente | ✅ presente (é a essência do delta) | `ReconciliacaoPermutaService.ts:310-344`; ADR-0030 §Decisão |
| Rollback (backward recovery) | A limpeza faz rollback do passo 1 do handshake (borderô) e do cache local; não desfaz baixas confirmadas (impossível, por I-Write-3) | ✅ presente (parcial por design) | `ReconciliacaoPermutaService.ts:326-327` |
| Repair State | `deleteBorderoCache` remove o registro derivado; próximo `refreshCache` regrava com a verdade do ERP | ✅ presente | `ReconciliacaoPermutaService.ts:327`; `BorderoGestaoService.ts:462-476` |
| Idempotent Replay | Pré-existente (idempotency-key + fail-closed do `reconciling` in-doubt); no delta, `borderoCriadoAqui` é `false` em cada nova chamada, então limpeza da chamada anterior não colide com a atual | ✅ presente (pré-existente + compatível) | `ReconciliacaoPermutaService.ts:146, 200-228` |
| Redundancy (Voting, comparação de fontes) | ERP + trilha local são vistos como fontes divergentes; ERP vence sempre que há divergência (I-Write-7 §"contagem vem do ERP") | ✅ presente | `BorderoGestaoService.ts:264-272`; ADR-0030 |
| Quarantine (Recover) | Linhas `error` na trilha mantêm o borCod para diagnóstico; borderô com item parcial NÃO é apagado (limpeza vira `BUSINESS_WARN` → analista trata) | ✅ presente | `ReconciliacaoPermutaService.ts:319-323`; ADR-0030 §"Escopo deliberadamente fora" |
| Reconcile (varredura ativa) | **Deliberadamente FORA** do escopo — órfãos legados NÃO são varridos; painel oferece "Excluir" por borderô | ✅ N/A (justificado) | ADR-0030 §"Escopo deliberadamente fora" |
| Substitution / Replacement / Increase Competence Set (Avoid) | N/A — não há redundância ativa nem hot-spare para o `fin010` | N/A | uma única fonte de escrita (ERP monolítico) |
| Predictive Model | N/A — a falha é reativa (nada a "prever" antes do POST 1) | N/A | — |
| Self-Test | N/A — não aplicável ao caminho de escrita de curta duração | N/A | — |
| Voting | N/A — não há réplicas | N/A | — |
| Timestamp | N/A neste delta (a trilha já carimba `criadoEm`/`atualizadoEm` no repositório pré-existente) | N/A | fora do delta |
| Reintroduction (Shadow / State Resync / Escalating Restart) | N/A — flow síncrono; não há ator para reintroduzir | N/A | — |
| Recovery (forward) | Analista é o caminho forward: painel mostra `error`+`erroMensagem`; "Excluir" cobre os órfãos que sobraram; "Aprovar" fica desabilitado para casco vazio | ✅ presente | `BorderosPanel.tsx:468-485`; `BorderoGestaoService.ts:158-194` |

## 4. Findings (achados)

### F-fault-tolerance-1: Falha parcial no `removerBorderoOrfao` (ERP apaga, cache falha) deixa cache inconsistente e log enganoso

- **Severidade**: P2
- **Tactic violada**: Rollback (backward recovery) — a operação composta ERP+cache não é atômica; falha do segundo passo mascara o sucesso do primeiro no log
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:310-344`
- **Evidência (objetiva)**:
  ```ts
  try {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length > 0) { /* warn e return */ }
      await this.conexosBaixaClient.excluirBordero({ filCod, borCod }); // (1) apaga no ERP
      await this.execucaoRepository.deleteBorderoCache(filCod, borCod); // (2) apaga no cache
      await this.logService.info({ /* "borderô órfão (vazio) removido..." */ });
  } catch (err) {
      await this.logService.warn({
          message: 'falha ao remover o borderô órfão (best-effort) — remover pelo painel',
          // ↑ mensagem incorreta se (1) sucedeu e (2) falhou: no ERP não há nada a remover
          data: { adiantamentoDocCod, borCod, erro: /* ... */ },
      });
  }
  ```
- **Impacto técnico**: Se `excluirBordero` sucede e `deleteBorderoCache` falha (DB do backend indisponível/timeout), o try inteiro cai no catch: (a) o borderô fica APAGADO no ERP mas AINDA presente no cache local até o próximo `refreshCache`; (b) o `warn` induz o analista a tentar "remover pelo painel" — ação que baterá em 404/erro do ERP (borderô já não existe). Auto-recuperável no próximo `refreshCache` (que faz `replaceBorderoCache` a partir do `listBorderos` do ERP), mas cria janela confusa até lá.
- **Impacto de negócio**: baixo — o casco não é aprovável (I-Write-7 §consumidor cobre); confusão do analista até o próximo refresh (segundos a minutos). Não perde dinheiro; polui operação.
- **Métrica de baseline**: 0 testes cobrindo o cenário `deleteBorderoCache` falha depois de `excluirBordero` sucesso (busca em `ReconciliacaoPermutaService.test.ts` — só há uses no happy-path do multi-título/settled).

### F-fault-tolerance-2: `assertBorderoTemItens` acopla aprovação à disponibilidade síncrona do ERP sem timeout/fallback explícito

- **Severidade**: P2
- **Tactic violada**: Timeout / Sanity Checking (a checagem em si é correta, mas depende de uma chamada síncrona ao ERP sem contenção explícita no serviço)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:200-217, 264-272`
- **Evidência (objetiva)**:
  ```ts
  public finalizarBordero = async (params: {...}) => {
      const filCod = await this.guardAcaoBordero(params.borCod);
      await this.assertBorderoTemItens(filCod, params.borCod); // ← nova chamada ao ERP (listBaixas)
      await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod });
      // ...
  };
  private assertBorderoTemItens = async (filCod: number, borCod: number): Promise<void> => {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length === 0) throw new Error(`Borderô ${borCod} não possui baixas ...`);
  };
  ```
- **Impacto técnico**: Se `listBaixas` falha (network, 500, timeout do axios), a exceção sobe e o analista NÃO consegue aprovar borderôs legítimos enquanto o ERP oscila. Não é uma regressão dura vs. o comportamento anterior (o `finalizarBordero` do ERP também falharia com ERP indisponível), mas: (a) adiciona 1 ponto de falha antes do POST, (b) a mensagem de erro que sobe ao analista é a genérica do client (não indica "aprovação recusada"), e (c) `listBaixas` retornando `[]` por qualquer razão que NÃO seja "borderô sem item" (ex.: 403, filial errada) vira o falso-negativo "não possui baixas — use Excluir", empurrando o analista a apagar um borderô legítimo.
- **Impacto de negócio**: baixo em disponibilidade (ERP down = fluxo travado de qualquer jeito), MÉDIO em UX de erro (analista pode ser induzido a excluir por engano quando o ERP tá com defeito temporário no `listBaixas`). Mitigável com mensagem de erro específica.
- **Métrica de baseline**: 2 testes cobrindo o guard (`listBaixas` vazio → recusa) e (trilha `error` não conta) em `BorderoGestaoService.test.ts:376-404`; 0 testes cobrindo `listBaixas` lançando/timeout no caminho da aprovação.

### F-fault-tolerance-3: Guarda `listBaixas` da limpeza é a única defesa contra super-exclusão em janela de leitura stale — sem timeout próprio na chamada

- **Severidade**: P2
- **Tactic violada**: Timeout / Redundancy (Voting)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:316-326`
- **Evidência (objetiva)**:
  ```ts
  const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
  if (baixas.length > 0) { /* fail-safe: não apaga */ return; }
  await this.conexosBaixaClient.excluirBordero({ filCod, borCod });
  ```
- **Impacto técnico**: Cenário concreto — `gravarBaixaPermuta` timeout do lado do cliente mas SUCESSO do lado do servidor: catch marca `error`, resultados.some(settled) = false, cleanup dispara. `listBaixas` é a única defesa: se ele TAMBÉM oscilar no exato momento e retornar `[]` (não por não haver baixas, mas por falha), a limpeza tentaria apagar um borderô com baixa REAL. Duas atenuações reais mitigam o risco: (i) `ConexosBaixaClient.excluirBordero`, pelo padrão observado em `BorderoGestaoService.excluirBordero:172-184` (que enumera-e-apaga baixa a baixa ANTES de chamar o endpoint), NÃO deve cascatear — provavelmente retorna erro do ERP com baixa vinculada; (ii) o `catch` externo transforma qualquer erro em `BUSINESS_WARN` sem perder o erro original da baixa. Não há teste dedicado a "`listBaixas` retorna vazio E `excluirBordero` sucede" para provar defense-in-depth.
- **Impacto de negócio**: BAIXO em probabilidade (requer dupla falha em janela de ms + comportamento não-cascade do ERP), ALTO em severidade se acontecer (baixa real deletada = divergência ERP↔ contábil no `fin010`). O `listBaixas` guard é o padrão certo; falta apenas cobertura de teste e timeout explícito.
- **Métrica de baseline**: 1 teste cobre "ERP relata item → não remove" (`ReconciliacaoPermutaService.test.ts:548-562`). 0 testes para o cenário `listBaixas` retorna `[]` mas `excluirBordero` erra por conflito (validando o segundo nível de defesa).

### F-fault-tolerance-4: Idempotência do `assertBorderoTemItens` em condição de corrida com uma baixa que entra entre a checagem e o POST

- **Severidade**: P3
- **Tactic violada**: Timestamp / Sanity Checking (a checagem é do tipo TOCTOU quando duas ações concorrentes agem no mesmo borderô)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:200-217`
- **Evidência (objetiva)**:
  ```ts
  await this.assertBorderoTemItens(filCod, params.borCod); // T1: lê listBaixas
  await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod }); // T2: aprova
  ```
- **Impacto técnico**: Entre T1 e T2 alguém pode: (a) apagar a última baixa do borderô no ERP, ou (b) adicionar uma nova baixa. No caso (a), a aprovação segue e o ERP recusa com o `"NÃO POSSUI ITENS"` — regressão para o pré-delta APENAS naquela corrida, tolerável. No caso (b), a aprovação segue e vale. Sem risco de money-loss.
- **Impacto de negócio**: Muito baixo — a janela é curtíssima e o pior caso é o texto do ERP antigo voltar em uma corrida. Não vale a defesa (custo > benefício).
- **Métrica de baseline**: n/a — cenário adversarial, não observado.

## 5. Cards Kanban

### [fault-tolerance-1] Cobrir o cenário "ERP apagou, cache falhou" no `removerBorderoOrfao`

- **Problema**
  > `removerBorderoOrfao` faz `excluirBordero` (ERP) → `deleteBorderoCache` (local) → log dentro do MESMO `try`. Se o ERP sucede e o cache falha, o catch loga `BUSINESS_WARN` "remover pelo painel" — mensagem enganosa (o borderô já não existe no ERP) e cache fica temporariamente inconsistente até o próximo `refreshCache`.

- **Melhoria Proposta**
  > Separar as duas operações: envelopar `deleteBorderoCache` em try/catch próprio; se o ERP sucedeu mas o cache falhou, logar `BUSINESS_INFO` "borderô removido do ERP; cache limpará no próximo refresh" (não um warn). Adicionar teste que simula `deleteBorderoCache` rejeitando e verifica o log final. Tactic Bass: **Rollback** granular por passo.

- **Resultado Esperado**
  > A mensagem de log casa com o estado real do sistema; o warn não confunde o analista para apagar algo que já não existe. Cobertura de teste do cenário sobe de 0 para 1.

- **Tactic alvo**: Rollback (por passo) + Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Testes cobrindo "ERP sucesso + cache falha": 0 → 1
  - Log correto no cenário: 0/1 → 1/1
- **Risco de não fazer**: Confusão operacional pontual quando o DB do backend oscila logo depois de uma escrita no ERP. Sem risco financeiro direto.
- **Dependências**: nenhuma

### [fault-tolerance-2] Traduzir a falha do `listBaixas` no `assertBorderoTemItens` para mensagem específica

- **Problema**
  > `assertBorderoTemItens` chama `listBaixas` como sanity check antes do POST de `finalizarBordero`. Se `listBaixas` LANÇA (network/timeout/403), a exceção sobe crua para o analista — a UI vai mostrar "Falha — …" sem indicar que a aprovação não chegou a ser tentada. Além disso, se `listBaixas` retorna `[]` por outro motivo (403/filial errada) que não "sem itens", o analista é induzido a excluir um borderô legítimo pela mensagem "não possui baixas — use Excluir".

- **Melhoria Proposta**
  > Envolver a chamada em try/catch: (a) em erro de I/O, lançar exceção específica ("não consegui confirmar itens do borderô no Conexos; tente novamente"), sem sugerir excluir; (b) considerar exigir que a resposta do `listBaixas` seja `undefined`/`null` para "não medível" vs. `[]` explícito para "sem itens", ou log de discriminação. Tactic Bass: **Sanity Checking** com resposta discriminada + **Timeout** propagado.

- **Resultado Esperado**
  > Mensagens de erro do analista distinguem "borderô realmente vazio (use Excluir)" de "não consegui confirmar (tente de novo)". Sem falso incentivo para excluir borderô legítimo.

- **Tactic alvo**: Sanity Checking + Timeout
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Testes de erro do `listBaixas` no `finalizarBordero`: 0 → 1
  - Mensagens distintas para "vazio" vs. "indisponível": 1 → 2
- **Risco de não fazer**: Em uma janela de instabilidade do ERP, um analista bem-intencionado pode acionar "Excluir" achando que o borderô está vazio.
- **Dependências**: nenhuma

### [fault-tolerance-3] Reforçar defense-in-depth da limpeza: teste do 2º nível (`excluirBordero` rejeita quando há baixa vinculada)

- **Problema**
  > A guarda `listBaixas>0 → não apaga` é a defesa primária contra apagar borderô com baixa real. O 2º nível (ERP recusar `excluirBordero` de borderô com item) NÃO é validado por teste. Se um dia o comportamento do ERP mudar (cascade delete) ou se `listBaixas` retornar `[]` por causa não-de-ausência, não temos um trip-wire.

- **Melhoria Proposta**
  > Adicionar teste que simula: `listBaixas` retorna `[]` (contrário à realidade), `excluirBordero` rejeita com "borderô tem baixas vinculadas"; verificar que o outer catch loga `BUSINESS_WARN` sem propagar. Documentar em `fin010-write-contract.md` (I-Write-7) que a 2ª linha de defesa depende do comportamento do endpoint `moduleBordero.delete` — se o ERP algum dia passar a cascatear, este teste falhará e sinalizará. Tactic Bass: **Voting/Redundancy** (duas fontes de sanity), **Condition Monitoring**.

- **Resultado Esperado**
  > Cobertura de teste do 2º nível de defesa passa a existir; qualquer mudança contratual do ERP (`excluirBordero` cascatear) é detectada por teste.

- **Tactic alvo**: Voting / Redundancy + Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Testes cobrindo o 2º nível de defesa: 0 → 1
  - Documentação da contra-invariante no ERP (I-Write-7 §2ª linha): ausente → presente
- **Risco de não fazer**: Baixo hoje; ALTO se o ERP mudar. Sem trip-wire, a mudança passaria silenciosa e o próximo casco varreria uma baixa real.
- **Dependências**: nenhuma

### [fault-tolerance-4] Documentar decisão explícita sobre `removerBorderoOrfao` sem timeout próprio

- **Problema**
  > `removerBorderoOrfao` chama `listBaixas` e `excluirBordero` sem timeout definido no site da chamada — herda o timeout do `ConexosBaixaClient`. Se o axios estiver com timeout longo, uma limpeza pendurada pode segurar a resposta HTTP do `reconciliar` inteira. Como a limpeza é higiene, ela NÃO deveria segurar a resposta para o analista.

- **Melhoria Proposta**
  > Uma de duas alternativas: (a) mover `removerBorderoOrfao` para fora do caminho síncrono (fire-and-forget com `setImmediate`/queue), ou (b) confirmar por HAR/config que o timeout do `ConexosBaixaClient` está ≤10s e documentar essa dependência em I-Write-7. Preferência: (b), pelo custo. Tactic Bass: **Timeout** explícito.

- **Resultado Esperado**
  > A limpeza best-effort não segura a resposta ao analista além do teto documentado; timeout do client validado.

- **Tactic alvo**: Timeout
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — se for só documentar
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Timeout máximo da resposta do `reconciliar` no caminho de falha total: documentado (valor exato) ou fire-and-forget
- **Risco de não fazer**: Muito baixo — a rota `reconciliar` já tem seu próprio budget do lado do consumidor.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo respeitado**: 5 arquivos do delta + baseline `_shared-metrics.md`. Não fui em `ConexosBaixaClient`, `PermutaExecucaoRepository`, `AlocacaoPermutasService` — todos referenciados mas fora do delta.
- **Severidade rebaixada de propósito**: o task pedia para "avaliar seriamente" o risco de apagar baixa real. Cheguei a considerar P0/P1, mas a combinação (i) `borderoCriadoAqui` só true na chamada onde nós criamos, (ii) guard `listBaixas>0`, (iii) padrão em `BorderoGestaoService.excluirBordero` (enumera-e-apaga baixa a baixa antes) sugerindo que o `excluirBordero` do ERP NÃO cascateia, (iv) fail-safe do outer catch, formam 4 camadas de defesa. Cenário concreto de perda exigiria falha simultânea de duas chamadas ao ERP + comportamento inesperado do `excluirBordero` do lado do ERP. P2 é defensável; documentei a dupla contingência em F-fault-tolerance-3.
- **Interação com o in-doubt guard (R-4)**: `borderoCriadoAqui` é resetado para `false` em cada `reconciliar`. Se uma chamada anterior deixou `reconciling` in-doubt, a chamada seguinte cai no fail-closed (linhas 200-228) ANTES de qualquer criação de novo borderô — a limpeza da chamada nova NÃO age sobre o borderô antigo. Sem colisão observável.
- **Cross-QA**:
  - **Testability**: 2 testes específicos podem ser adicionados (F-fault-tolerance-1 e F-fault-tolerance-3) — cardinho pequeno cada.
  - **Availability**: F-fault-tolerance-2 tem sobreposição — a chamada extra ao ERP em `finalizarBordero` afeta MTBF percebido pelo analista quando o ERP oscila.
  - **Security**: fora do escopo do delta (o `requireOwnBorderoFilCod` já cobre confused-deputy e é pré-existente).
  - **Performance**: +1 chamada síncrona ao ERP no happy-path de aprovação — trade-off aceito em ADR-0030, sem alerta adicional.
