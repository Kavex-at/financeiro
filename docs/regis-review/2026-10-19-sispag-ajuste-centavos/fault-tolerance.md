---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-19-sispag-ajuste-centavos
agent: qa-fault-tolerance
generated_at: 2026-10-19T00:00:00-03:00
scope: backend
score: 6.5
findings_count: 7
cards_count: 6
---

# Fault Tolerance — Regis-Review (delta: ajuste de centavos SISPAG, ADR-0073)

Escopo: `git diff origin/main...HEAD`, sem `jobs/probe-*.ts`. Modo do ajuste = `off` por default. Não há `infra/` (filas SQS/DLQ: N/A; a recuperação aqui é ledger + varredura no processo do servidor).

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista confirma boleto (ou "tentar de novo"/abrir tela) | Queda do processo, timeout ou resposta perdida do Conexos no meio da sequência `fin070` (criar → incluir → compor → aplicar → finalizar → liberar `fin103`) | `AjusteCentavosTituloService`, `AjusteCentavosExecucaoRepository`, ledger `sispag_ajuste_centavos_execucao` (0087), `finalizarLote`, `.REM` | Servidor Express/Render, modo `on` (futuro), ERP sem rota de cancelamento provada (G3) | Antes do `finalizar`: compensar (cancelar `frnCod`); depois: só para a frente; retomada reconhece o estado pelo marcador na obs; rechaveamento local atômico | 0 renegociações duplicadas por título; 0 ledger preso sem alerta; 0 divergência decisão/carteira/item vs ERP; todo caso não resolvido vira estado terminal visível ao analista |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotência da escrita no ERP (chave `(fil,doc,titOrigem,decisao)` + índice único parcial de 1 não terminal por título + lock otimista por etapa) | presente | presente | ✅ | `0087_sispag_ajuste_centavos.sql` (UNIQUE + `ux_..._nao_terminal`); `registrarResultado` (`WHERE etapa = $de`) |
| Serialização por título (advisory lock) | presente (`pg_try_advisory_lock`, onBusy => `em_andamento`) | presente | ✅ | `AjusteCentavosTituloService.ts` `ajustar`; `PostgreeDatabaseClient.withAdvisoryLock` |
| Write-ahead da intenção antes de cada chamada de escrita ao ERP | todas as escritas passam por `passo()` | 100% | ✅ | `AjusteCentavosTituloService.ts` `passo` |
| Multi-escrita local do rechaveamento em 1 transação (decisão, carteira, itens RASCUNHO, ledger) | 1/1 | 100% | ✅ | `AjusteCentavosExecucaoRepository.rechavear` (`withTransaction`) |
| Par estado + trilha na mesma transação | decisão+eventos+ledger na tx; transições intermediárias do ledger só em log (o ledger é a trilha) | 100% | ⚠️ | `rechavear`; `transicionar` |
| Compensação antes do `finalizar` operacional | rota `cancelarRenegociacao` = `NotImplementedError` (G3) => `indeterminado` | cancelamento provado | ⚠️ | `compensar`; `CANCELAMENTO_FIN070_PROVADO = false` |
| Reaper/varredura de ledger preso | só ao abrir a tela e após `confirmar`; sem cron, sem idade máxima, sem alerta por tempo | presente | ⚠️ | `retomarPendentes`, `agendarVarredura`, `routes/sispag.ts` |
| Reconciliação periódica vs `fin070`/`fin064` | ausente (só reconhecimento na retomada) | presente | ❌ | n/d |
| Guarda do `finalizarLote` contra ajuste em curso | cobre só estados NÃO terminais | cobrir também `indeterminado` | ⚠️ | `LotePagamentoRepository.titulosComAjusteNaoTerminalNoLote` |
| Timeouts/retry nos clients novos | leituras com `RetryExecutor`; escrita em tentativa única (decisão registrada) | 100% | ✅ | `ConexosRenegociacaoClient` (cross-ref Availability) |
| Guardas que alteram comportamento INDEPENDENTE do modo (`I17m` BLOQUEIA, `I17n` líquido) | 2 ativas com modo `off`; medição G4/Task 13: 0 dos 30 dias de .REM medidos | medição feita antes do merge | ❌ | `MODO_GUARDA_VALOR_J = BLOQUEIA`; `ontology/_inbox/sispag-ajuste-centavos-rollout-g5.md:28` |
| Testes dos cenários de falha (casos 6–9, 11, 12, compensação, retomada) | 13 casos canônicos cobertos | 100% | ✅ | `AjusteCentavosTituloService.test.ts` |

⚠️ **Não medível localmente**: tempo que um ledger fica não terminal em PRD e taxa de `indeterminado`. Requer consulta à tabela em PRD após o rollout G5 (`SELECT etapa, count(*), max(now()-atualizado_em)`).

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Conferência `mnyValorTotal == valorBoleto` antes do `finalizar`; pós-condição do título novo (exatamente 1 candidato, original ausente); bloqueio só liberado com valor e comando "APROVAR" únicos | ✅ presente | `conferirAntesDeFinalizar`, `identificarTituloNovo`, `comandoParaLiberar` |
| Comparison | Elegibilidade recalculada ao vivo no início e antes do `finalizar`; releitura do `fin070`/`fin064` decide após falha ambígua | ✅ presente | `avaliarAoVivo`, `finalizar` |
| Timestamp | `intencao_em`, `atualizado_em`, `concluido_em`, `tentativas` no ledger; nada os consome para detectar preso | ⚠️ parcial | 0087 |
| Timeout | Delegado ao client (cross-ref Availability) | ✅ presente | `ConexosRenegociacaoClient` |
| Condition Monitoring | `logService.error` em `indeterminado`/`aguardando`; sem métrica nem painel de não terminais por idade | ⚠️ parcial | `alertar` |
| Self-Test (guarda do `.REM`) | `I17m`: J com pagamento ≠ barra bloqueia `REMESSA_GERADA`; default sem medição | ⚠️ parcial | `RemessaCnabValidator.divergenciaDeValor` |
| Voting / Redundancy | N/A: o ERP é fonte única, sem réplica | N/A | n/a |
| Recovery (forward) | Depois do `finalizar` só avança (liberar, rechavear); retomada por ledger | ✅ presente | `avancar` |
| Recovery (backward) / Rollback / Compensating Transaction | Cancelar `frnCod` antes do `finalizar`; rota ainda `NotImplementedError` (G3) | ⚠️ parcial (desenhada, não habilitada) | `compensar`; ontologia I18h |
| Idempotent Replay | Ledger write-ahead + marcador de correlação na obs; reconhece `frnCod` perdido; no-op sobre `concluido` | ✅ presente | `reconhecerPeloMarcador`, `ajustarComLock` |
| Reintroduction (State Resync) | Varredura de retomada; rechaveamento ressincroniza decisão/carteira/itens | ✅ presente | `retomarPendentes`, `rechavear` |
| Repair State | `cancelado`/`recusado`/`indeterminado` sem caminho de reabertura (F-2) | ❌ ausente | `ajustarComLock` |
| Reconcile | Sem job de conciliação com Conexos | ❌ ausente | n/d |
| Quarantine | `indeterminado` e `aguardando_aprovacao_manual` são terminais visíveis; `finalizarLote` não os bloqueia | ⚠️ parcial | `EtapaAjusteCentavos.ts` |
| Substitution / Predictive Model | N/A | N/A | n/a |
| Increase Competence Set | Elegibilidade estrita (Δ ≤ R$ 0,05, sem juros/parcial, 1 ajuste por linhagem) limita o domínio de falha | ✅ presente | ontologia I18a |

## 4. Findings

### F-fault-tolerance-1: Guardas I17m (BLOQUEIA) e I17n (líquido) mudam toda remessa com o modo do ajuste em `off`, sem a medição que o próprio código exige antes do merge

- **Severidade**: P0
- **Tactic violada**: Sanity Checking (fail-closed ativo sem baseline) / Condition Monitoring
- **Localização**: `src/backend/domain/libs/cnab/RemessaCnabValidator.ts` (`MODO_GUARDA_VALOR_J`); `src/backend/domain/service/sispag/RemessaService.ts` (`guardaValorDoJ`, chamada ~L903–917; `montarItensImport` ~L1455–1465)
- **Evidência (objetiva)**:
  ```
  /** ... O valor final é fixado pela medição só leitura dos .REM de PRD dos últimos 30 dias
      (Task 13) ANTES do merge ... */
  export const MODO_GUARDA_VALOR_J: GuardaValorJ = GUARDA_VALOR_J.BLOQUEIA;
  rollout-g5.md:28  - [ ] I17m ativo com o default final ... (aguardando a medição da Task 13)
  ```
  A guarda roda depois de `gerarRemessa` no ERP (arquivo e lote nativo já existem): o `throw RemessaBarcodeAmountMismatchError` os deixa no ERP "para cancelamento manual". O I17n lança `NetValueUnavailableError` quando o grid não traz líquido e há juros/desconto.
- **Impacto técnico**: qualquer J legítimo com pagamento ≠ valor da barra (boleto vencido com mora, abatimento, título legado sem vínculo) deixa de gerar remessa e cria lote nativo órfão no ERP. Independe do modo `off`.
- **Impacto de negócio**: pagamento SISPAG da Columbia bloqueado em produção sem aviso; retrabalho manual no Conexos.
- **Métrica de baseline**: `.REM` de PRD medidos = 0 de 30 dias; guardas ativas com modo `off` = 2.

### F-fault-tolerance-2: Ledger `cancelado` (e `recusado`) não é reabrível; "tentar de novo" devolve `executado` sem fazer nada

- **Severidade**: P1
- **Tactic violada**: Repair State / Idempotent Replay
- **Localização**: `AjusteCentavosTituloService.ts` `ajustarComLock` (curto-circuito do `ultimo` terminal) e `resultadoDe`; `AjusteCentavosExecucaoRepository.abrir` (UNIQUE `(fil,doc,tit,decisao)` + `ON CONFLICT DO NOTHING`)
- **Evidência (objetiva)**:
  ```
  ultimo.decisaoId === p.decisaoId && ehTerminal(ultimo.etapa) && ultimo.etapa !== RECUSADO
    => return this.resultadoDe(ultimo, modo)   // terminal != recusado => 'executado'
  sugestaoBoleto.ts:313  cancelado: 'o ajuste foi cancelado ... tente de novo'
  ```
  Para `recusado`, a avaliação roda, mas `abrir` esbarra na chave de idempotência e devolve o ledger terminal antigo.
- **Impacto técnico**: depois de uma compensação legítima (falha transitória antes do `finalizar`), a UI manda tentar de novo e o backend responde sucesso falso (`executado`) sem escrever. O título só destrava com nova decisão (anular e reconfirmar).
- **Impacto de negócio**: os 109 títulos NELSON (+R$ 0,01) seguem sem ajuste após qualquer falha, com a tela dizendo que foi feito.
- **Métrica de baseline**: terminais não reabríveis por retry = 2 (`cancelado`, `recusado`); terminais sem sucesso mapeados a `executado` = 3 (`cancelado`, `indeterminado`, `aguardando_aprovacao_manual`).

### F-fault-tolerance-3: `indeterminado` é terminal sem fila durável nem bloqueio do `finalizarLote`; só `logService.error`

- **Severidade**: P1
- **Tactic violada**: Quarantine / Recovery (forward)
- **Localização**: `AjusteCentavosTituloService.ts` `indeterminar`, `compensar`, `rechavear`; `LotePagamentoRepository.titulosComAjusteNaoTerminalNoLote`
- **Evidência (objetiva)**:
  ```
  titulosComAjusteNaoTerminalNoLote: a.etapa NOT IN ('concluido', ..., 'cancelado','recusado','indeterminado','simulado')
  compensar: cancelarRenegociacao falha OU releitura falha => indeterminar(...)  // não relê depois
  ```
  Pós-`finalizar`, `indeterminado` (título novo ausente/ambíguo) deixa o item RASCUNHO apontando para título já consumido no ERP, e `finalizarLote` passa. Pré-`finalizar`, fica uma renegociação aberta no `fin070` com o título original incluído (com G3 pendente, isso acontece em toda falha com `on`).
- **Impacto técnico**: divergência decisão/carteira/item x ERP sem superfície além do log; sem reabertura nem releitura do cancelamento.
- **Impacto de negócio**: lote finalizado com título inexistente (falha só no `fin015`/banco); título travado em renegociação aberta no Conexos.
- **Métrica de baseline**: caminhos que terminam em `indeterminado` = 9 no serviço; 0 com item em fila de exceção do analista.

### F-fault-tolerance-4: Retomada só ocorre com alguém abrindo a tela; não terminal bloqueia `finalizarLote` sem prazo, escape nem alerta por idade

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring / Timestamp (stuck-state detection)
- **Localização**: `retomarPendentes`, `agendarVarredura`, `agendarAposConfirmar` (fire-and-forget); `routes/sispag.ts` `/ajustes-centavos/retomar`; `LotePagamentoService.finalizarLote` (guarda I18k)
- **Evidência (objetiva)**:
  ```
  void (async () => { try { ajustar(...) ... } catch { logService.error } })();
  // sem cron por desenho (I18g); `tentativas`/`atualizado_em` gravados, nunca lidos para alerta
  ```
  Reinício do Render entre o commit do `confirmar` e o `ajustar` perde o gatilho (coberto só por varredura posterior). Ledger preso em `finalizada` por falha persistente de leitura mantém o `finalizarLote` em 409 indefinidamente.
- **Impacto técnico**: tempo não terminal ilimitado; sem reconciliação periódica contra o `fin070`/`fin064`.
- **Impacto de negócio**: lote da filial não fecha e ninguém é avisado no prazo do dia de pagamento.
- **Métrica de baseline**: idade máxima tolerada de não terminal = indefinida (alvo: alerta > 15 min); jobs de reaper/reconciliação = 0.

### F-fault-tolerance-5: Advisory lock de sessão segura uma conexão do pool durante todo o fluxo e pode vazar se o unlock falhar

- **Severidade**: P2
- **Tactic violada**: Containment (isolamento de recurso compartilhado)
- **Localização**: `PostgreeDatabaseClient.withAdvisoryLock` (usado em `ajustar`)
- **Evidência (objetiva)**:
  ```
  client = pool.connect(); pg_try_advisory_lock(k); await onAcquired(); // várias chamadas ao ERP
  finally { pg_advisory_unlock(k) } ; client.release()   // unlock lança => lock fica na sessão devolvida ao pool
  ```
- **Impacto técnico**: ajustes concorrentes consomem conexões do pool durante chamadas ao ERP; falha de unlock deixa o título em `em_andamento` até a conexão ser reciclada.
- **Impacto de negócio**: possível degradação das telas do SISPAG no pool compartilhado durante varredura grande.
- **Métrica de baseline**: conexões retidas por ajuste = 1 durante todo o fluxo; varredura é sequencial, pico atual = 1 por varredura.

### F-fault-tolerance-6: Guarda do `finalizarLote` é verificada fora da transação; janela entre a checagem ao vivo do ajuste e o rechaveamento

- **Severidade**: P2
- **Tactic violada**: Sanity Checking (TOCTOU)
- **Localização**: `LotePagamentoService.ts` (guarda I18k), `AjusteCentavosTituloService.conferirAntesDeFinalizar`, `trocarTituloDoItemEmRascunho` (só `RASCUNHO`)
- **Evidência (objetiva)**:
  ```
  emAjuste = await this.repo.titulosComAjusteNaoTerminalNoLote(input.loteId)   // sem tx / FOR UPDATE
  ```
  Lote finalizado entre a conferência `tituloEmLoteFechado` e o `rechavear` fica com `tit_cod` do título consumido; o rechaveamento não toca lote não `RASCUNHO`.
- **Impacto técnico**: janela de segundos a minutos; resultado é o mesmo estado divergente do F-3.
- **Impacto de negócio**: baixo (exige modo `on` e analista finalizando o lote do mesmo título durante o ajuste).
- **Métrica de baseline**: janela ≈ duração das etapas `finalizar` + `liberar`; ocorrências medidas = 0 (modo `off`).

### F-fault-tolerance-7: Política de recuperação forward-only não tem runbook

- **Severidade**: P3
- **Tactic violada**: Recovery (documentação operacional)
- **Localização**: ontologia I18h / ADR-0073; `ontology/_inbox/sispag-ajuste-centavos-rollout-g5.md`
- **Evidência (objetiva)**: ADR descreve `indeterminado`/`aguardando_aprovacao_manual`; nenhum passo a passo ("o que o analista faz no fin070/fin103 para cada motivo").
- **Impacto técnico**: nenhum no código.
- **Impacto de negócio**: tempo de resolução depende de quem lê o log.
- **Métrica de baseline**: runbooks = 0 para os motivos de `indeterminado` e `aguardando`.

## 5. Cards Kanban

### [fault-tolerance-1] Fechar a medição G4 e decidir o default da guarda I17m antes do merge

- **Problema**
  > `MODO_GUARDA_VALOR_J = BLOQUEIA` e o líquido obrigatório do I17n estão ativos com o ajuste em `off`, e a medição de 30 dias de `.REM` que o código declara pré-requisito do merge não foi feita. A guarda dispara depois do `gerarRemessa`, deixando arquivo e lote nativo órfãos no ERP.
- **Melhoria Proposta**
  > Rodar a medição só leitura (Task 13) e registrar o resultado no `_inbox`; se houver J legítimo com pagamento ≠ barra, mergear com `AVISA` e promover a `BLOQUEIA` por ADR. Alternativa: pôr a guarda atrás de configuração por filial (default `AVISA`). Tactic: Sanity Checking com baseline.
- **Resultado Esperado**
  > Nenhuma remessa legítima bloqueada no merge. `.REM` medidos: 0 → 30 dias.
- **Tactic alvo**: Sanity Checking
- **Severidade**: P0
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - `.REM` de PRD medidos: 0 → 30 dias
  - Guardas ativas sem medição: 2 → 0
- **Risco de não fazer**: Primeira remessa com mora legítima falha em PRD com lote nativo órfão, sem relação aparente com a feature (modo `off`).
- **Dependências**: acesso de leitura a PRD (cuidado com a memória "probe local derruba sessão Conexos").

### [fault-tolerance-2] Permitir nova tentativa depois de `cancelado`/`recusado` e não responder `executado` para terminal sem sucesso

- **Problema**
  > `tentarDeNovo` sobre ledger `cancelado` cai no no-op e devolve `executado`; o índice de idempotência por decisão impede abrir novo ledger. A UI promete "tente de novo".
- **Melhoria Proposta**
  > Em `ajustarComLock`, tratar `cancelado` (e `recusado` por motivo transitório) como reabrível no gatilho `TENTAR_DE_NOVO`: novo ledger (relaxar a chave para incluir tentativa) ou reabrir a linha com `tentativas+1`. Mapear `cancelado`/`indeterminado`/`aguardando_aprovacao_manual` a resultados próprios em `resultadoDe`. Testes novos para os dois caminhos.
- **Resultado Esperado**
  > "Tentar de novo" após compensação executa de fato; resultado nunca diz `executado` sem título novo.
- **Tactic alvo**: Repair State
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Terminais não reabríveis por retry: 2 → 0
  - Falsos `executado`: 3 estados → 0
- **Risco de não fazer**: Títulos que falharam uma vez nunca são ajustados e o analista acredita que foram.
- **Dependências**: nenhuma (antes do `on`).

### [fault-tolerance-3] Tratar `indeterminado` como quarentena: bloquear `finalizarLote`, mostrar na fila de exceção e reler o cancelamento

- **Problema**
  > `indeterminado` é terminal, só gera `logService.error`, não bloqueia `finalizarLote` e, pós-`finalizar`, deixa item RASCUNHO apontando para título consumido.
- **Melhoria Proposta**
  > Incluir `indeterminado` na guarda de `titulosComAjusteNaoTerminalNoLote`; expor na fila de bloqueados do analista com motivo; permitir ação "reavaliar" que relê o `fin070` (cancelamento já efetivado, título novo presente). Tactic: Quarantine + Reconcile.
- **Resultado Esperado**
  > Todo `indeterminado` aparece para o analista e impede lote com título inconsistente.
- **Tactic alvo**: Quarantine
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-6
- **Métricas de sucesso**:
  - Caminhos `indeterminado` sem superfície ao analista: 9 → 0
  - Lotes finalizáveis com título `indeterminado`: possível → 0
- **Risco de não fazer**: Lote finalizado com título inexistente; título preso em renegociação aberta no Conexos.
- **Dependências**: G3 (rota de cancelamento), fila de exceção do SISPAG.

### [fault-tolerance-4] Alerta por idade para ledger não terminal e conciliação de leitura com o `fin070`

- **Problema**
  > Retomada depende de alguém abrir a tela; não terminal bloqueia `finalizarLote` indefinidamente; `atualizado_em`/`tentativas` não são lidos.
- **Melhoria Proposta**
  > Expor no `GET /ajustes-centavos` a idade e `tentativas`; alerta (log estruturado + selo na tela) acima de N minutos; avaliar job só de leitura de conciliação (o I18g veta cron de escrita). Tactic: Condition Monitoring.
- **Resultado Esperado**
  > Preso detectado em menos de 15 min do primeiro acesso à tela.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Idade máxima de não terminal sem alerta: ilimitada → 15 min
  - Reapers/conciliações: 0 → 1
- **Risco de não fazer**: Lote da filial parado no dia de pagamento sem ninguém saber.
- **Dependências**: card 3.

### [fault-tolerance-5] Não segurar conexão do pool durante o fluxo do ERP

- **Problema**
  > `withAdvisoryLock` mantém uma conexão por ajuste durante todas as chamadas ao ERP; falha no unlock vaza o lock.
- **Melhoria Proposta**
  > Lock transacional curto (`pg_try_advisory_xact_lock`) só para abrir/retomar o ledger, apoiando a exclusão no ledger (índice único parcial + `registrarResultado` condicional, já existentes); destruir a conexão se o unlock falhar.
- **Resultado Esperado**
  > Conexões retidas durante chamadas ao ERP: 1 → 0; sem lock órfão.
- **Tactic alvo**: Contain Faults (isolamento)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Conexões retidas durante chamada ao ERP: 1 → 0
- **Risco de não fazer**: Esgotamento do pool numa varredura grande.
- **Dependências**: nenhuma.

### [fault-tolerance-6] Runbook de `indeterminado` e `aguardando_aprovacao_manual`

- **Problema**
  > A recuperação é forward-only por desenho, mas não há passo a passo para o time.
- **Melhoria Proposta**
  > Adicionar ao `DEPLOY.md`/runbook uma tabela motivo → ação no `fin070`/`fin103` (cancelar `frnCod`, aprovar título, reavaliar). Registrar como escolha explícita no ADR-0073.
- **Resultado Esperado**
  > Todos os motivos cobertos; resolução sem depender do desenvolvedor.
- **Tactic alvo**: Recovery (forward)
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-7
- **Métricas de sucesso**:
  - Motivos com runbook: 0 → todos
- **Risco de não fazer**: Resolução lenta e inconsistente no primeiro incidente real.
- **Dependências**: cards 2 e 3 (estados finais).

## 6. Notas do agente

- Pontos fortes: ledger write-ahead por etapa, transições validadas por máquina pura com lock otimista, marcador de correlação para resposta perdida, rechaveamento em uma transação, compensação só antes do `finalizar`. Nenhum P0 no executor em si com o modo `off`; o único P0 é a ativação das guardas I17m/I17n independente do modo.
- F-1 só vale como P0 enquanto a medição G4 estiver pendente: o próprio código a coloca como pré-requisito do merge.
- Cross-QA: timeouts/retry => Availability e Performance; trilha de auditoria (eventos `AJUSTE_*`, `conexos_usn_cod`) => Security; cenários de reabertura/retry sem teste (F-2, F-3) => Testability; guarda `.REM` => Integrability.
- Não medível: SQS/DLQ (inexistentes neste repo); taxa de `indeterminado` em PRD.
