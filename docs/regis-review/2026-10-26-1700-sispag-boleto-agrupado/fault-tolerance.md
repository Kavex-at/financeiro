---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-26-1700-sispag-boleto-agrupado
agent: qa-fault-tolerance
generated_at: 2026-10-26T17:00:00-03:00
scope: backend
score: 7.5
findings_count: 7
cards_count: 7
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operadora clica "gerar remessa" com grupo de boleto no lote; processo Render cai entre `POST fin010` e a persistência da identidade (`borCod`+`borTimCad`); ou mensagem HTTP/Conexos é entregue duas vezes | Falha parcial no meio do write-ahead (`intencao_gravada` → `bordero_criado` → `baixas_gravadas` → `importado`), ou retomada depois de erro transitório, ou J rejeitado pelo banco, ou cancelamento do lote local, ou cliques duplos em `arquivosRetorno/processar` | `BorderoGrupoBoletoService` (preparação + limpeza), `FechamentoGrupoBoleto` (fecho pago/rejeitado), `CasamentoRetornoGrupo` (match do item de borderô no retorno), `ConciliacaoRetornoService` (idempotência da conciliação) | Produção SISPAG com `SISPAG_LIVE_WRITE_ENABLED=on`, borderôs reais no `fin010`, lote nativo aberto; ou dry-run/shadow quando o kill-switch cai | Zero borderô órfão desconhecido pelo sistema; zero item nativo pago duas vezes; cada falha vira retomada idempotente ou `retirar` determinístico OU `indeterminado`+`Alerta` para a analista; limpeza só mexe no borderô próprio e com `fin015` ainda aberto; retorno processado uma única vez por `(fil,bnc,gtb,gar)` | `preparar` idempotente em ≥99% dos caminhos cobertos; conciliação idempotente comprovada no `_shared-metrics` (fase HML `canonico` 6/6); fases HML `falha/retomada/v7` + medição PRD GT1/GT2 ainda PENDENTES |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas no `fin010` precedidas de write-ahead (etapa `intencao_gravada` + `escrita_iniciada_em`) | 100% dos caminhos (`criarNovo`, `retomar→criarBordero(true)` chamam `ledger.abrir` com `t0` e `registrarInicioEscrita`) | 100% | ✅ | `BorderoGrupoBoletoService.ts:389-402, 533-538`; `GrupoBoletoExecucaoRepository.ts:242-290, 293-304` |
| Idempotência de `registrarBordero` (não troca identidade existente) | Sim: `UPDATE ... WHERE id=? AND (bor_cod IS NULL OR (bor_cod=? AND bor_tim_cad=?))` + retorno booleano para `indeterminado` | Sim | ✅ | `GrupoBoletoExecucaoRepository.ts:311-338`; `BorderoGrupoBoletoService.ts:465-477, 549-556` |
| Transição `registrarEtapa` com optimistic lock sobre a etapa de origem | Sim (`WHERE id=? AND etapa=$de`) | Sim | ✅ | `GrupoBoletoExecucaoRepository.ts:370-398`; uso em `BorderoGrupoBoletoService.ts:1019-1038` |
| Conciliação de retorno com chave de idempotência (`fil:bnc:gtb:gar`) + consulta ao `processadoEm` do ERP antes do `PUT` | Presente; curto-circuito em `settled`; `reconciling` + `processadoEm` reconhece órfão; `estado` indeterminado ⇒ `ConciliacaoEmDuvidaError` | Presente | ✅ | `ConciliacaoRetornoService.ts:120-204, 230-234` |
| Casamento do J (item de borderô) com o grupo filtrando por `borCod` + `itsCodSeq` + `loteId` | Presente (ERP reusa `borCod`; `itsCodSeq` quando gravado) | Presente | ✅ | `CasamentoRetornoGrupo.ts:40-61` |
| Limpeza condicionada a kill-switch e a `fin015` aberto sem `.REM` | Guarda ao vivo via `getLoteNativo` + `listarArquivosRemessa`; falha-fechada se ilegível | Presente | ✅ | `BorderoGrupoBoletoService.ts:1145-1201` |
| Alerta `sispag-bordero-grupo-pendente` em todo desfecho que exige analista (retirado por anterior-não-resolvido, indeterminado, J rejeitado, limpeza pendente/falhada) | Presente, com `janelaInicio=startOfTodayBrt` para dedupe diário | 100% | ✅ | `BorderoGrupoBoletoService.ts:1082-1116, 1368-1402`; `FechamentoGrupoBoleto.ts:146-178`; `DisparoLimpezaBorderoGrupo.ts:91-147` |
| Divergência parcial do grupo (parte paga/parte não) sinalizada nos N títulos | `aplicarGrupos` cola `DETALHE_GRUPO_PARCIAL` quando `pagos ∈ (0, N)` e emite `SISPAG_BAIXA_DIVERGENTE` | 100% | ✅ | `DecisaoStatusLote.ts:72-78, 125-159` |
| Partial-paid NÃO leva o lote a `BAIXADO` sem rejeição | Correto: `destinoDoLote` só vai a `BAIXADO` com `every(PAGO)` | 100% | ✅ | `DecisaoStatusLote.ts:161-173` |
| Partial-paid dispara retirada automática do grupo da remessa gerada | **Ausente** — a divergência fica no estado dos itens e emite alerta; nenhum caminho `fin010`/limpeza é acionado quando o lote já tem `.REM` e banco pagou parcialmente | — | ⚠️ (projeto consciente: I21q só limpa com rascunho aberto; é problema HUMANO) | `DecisaoStatusLote.ts:125-159` |
| Testes verdes do delta | 305 suites / 5.939 testes BE; 122 suites / 1.355 FE | 100% | ✅ | `_shared-metrics.md` |
| HML — fase `canonico` do borderô agrupado | 6/6 passos (borderô 253) | 6/6 | ✅ | `_shared-metrics.md` |
| HML — fases `falha`, `retomada`, `v7`, medição PRD GT1/GT2 | PENDENTES | realizadas antes de ligar PRD | ❌ | `_shared-metrics.md` |
| Métrica em produção (taxa de `indeterminado`, `LIMPEZA_PENDENTE`, `j_rejeitado` por semana) | Não medível localmente — a frente nunca rodou em PRD | Dashboard+alerta operacional | ⚠️ | — |

> ⚠️ **Não medível localmente**: taxa de desfechos `INDETERMINADO`/`LIMPEZA_PENDENTE`/`j_rejeitado` em PRD. Requer o job de medição `GT1/GT2` (commit b87d8ab2) rodando read-only em PRD + agregação. Recomendação: executar o job uma vez por semana antes de ligar o feature flag em PRD e materializar o resultado numa view consultável no painel.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | `conferirAntesDaEscrita` (par VIGENTE, soma líquida, boleto não vencido, nenhum título vinculado no ERP, pool); `lerNosso` relê borderô pela identidade antes de qualquer baixa; `conferirBordero` compara N baixas + total; `concluirImport` compara `itsMnyValor` × `valorBoleto`; CNAB validator antes do `.REM` | ✅ presente | `BorderoGrupoBoletoService.ts:147-240, 586-619, 735-774, 827-838`; `RemessaService.ts:944-978` |
| Comparison (voting indireto) | Soma líquida vs valor do boleto, baixas esperadas vs encontradas, total do borderô vs boleto, valor do item nativo vs boleto | ✅ presente | `BorderoGrupoBoletoService.ts:759-765, 832-838` |
| Timestamp (write-ahead) | `escrita_iniciada_em` (t0) gravado ANTES do POST; `escrita_concluida_em` (t1) depois; identidade `(filCod, borCod, borTimCad)` | ✅ presente | `BorderoGrupoBoletoService.ts:385-402`; migration `0090_sispag_grupo_boleto.sql` |
| Timeout | Herdado dos clients Conexos (não exclusivo do delta) | ✅ presente (fora do escopo do delta) | `ConexosSispagClient` |
| Condition Monitoring | `buscarBorderoPorIdentidade` + `buscarBorderosNaJanela` + `getArquivoRetorno.processadoEm` para reconciliar o estado do ERP a cada retomada | ✅ presente | `BorderoGrupoBoletoService.ts:484-525, 586-619, 1162-1173`; `ConciliacaoRetornoService.ts:155-204` |
| Self-Test | Ausente por desenho (não há "health probe" do borderô, mas o `preflight` do grupo cobre a sanidade do estado) | ⚠️ parcial | — |
| Voting | N/A (único ERP; não há réplica para votar) | N/A | — |
| Redundancy (Active/Passive) | N/A — único ERP de verdade | N/A | — |
| Recovery — Backward (Rollback) | Limpeza (`limpar`) é rollback assistido: deleta item nativo, baixas e borderô, com releitura obrigatória; só com `fin015` aberto e sem `.REM`; respeita kill-switch. Nunca faz undo em borderô reaproveitado (só o item). | ✅ presente | `BorderoGrupoBoletoService.ts:1120-1293` |
| Recovery — Forward (Reintroduction) | `retomar` + `recuperarIdentidade` + `reconhecerPelaJanela` — a próxima tentativa continua a mesma execução pela identidade/janela; `fecharGrupo` idempotente roda a cada passada; `FechamentoGrupoBoleto` é tolerante a re-execução | ✅ presente | `BorderoGrupoBoletoService.ts:405-525`; `FechamentoGrupoBoleto.ts:53-83` |
| Reintroduction — Shadow | Dry-run/shadow: `conexosWriteEnabled=false ∨ sispagLiveWriteEnabled=false ∨ conexosDryRun=true` ⇒ etapa `SIMULADO`, nada escrito; mesmo gatilho na limpeza (`pendente` + Alerta) | ✅ presente | `BorderoGrupoBoletoService.ts:269-276, 357-383, 1145-1151` |
| State Resync | Depois de J rejeitado: `decidirAposRejeicao` relê o antigo pela identidade, decide por reaproveitamento / retirada / indeterminado; `chavesNativasConfirmadas` reconhece o item de borderô numa retomada da remessa | ✅ presente | `BorderoGrupoBoletoService.ts:871-922, 173-192` |
| Escalating Restart | N/A (sem orquestrador que escale) | N/A | — |
| Idempotent Replay | `fecharPago.marcarPago` só mexe na primeira vez (`APLICADO`); conciliação de retorno com chave idempotência + consulta a `processadoEm`; `registrarBordero` idempotente; alerta com janela diária. | ✅ presente | `FechamentoGrupoBoleto.ts:107-134`; `ConciliacaoRetornoService.ts:120-144`; `GrupoBoletoExecucaoRepository.ts:311-338` |
| Compensating Transaction | Desfecho `retirar` (I21p(3)) compensa a tentativa com `limpar` + retirada do grupo da remessa; J rejeitado NÃO desfaz o borderô (I21s, política explícita: forward recovery pela analista) | ✅ presente (política documentada) | `BorderoGrupoBoletoService.ts:1076-1099`; `FechamentoGrupoBoleto.ts:136-178` |
| Reconcile | `chavesNativasConfirmadas`, `borderoVivoDeOutraExecucao`, `getArquivoRetorno.processadoEm`, varredura `fin064` após baixa | ✅ presente | `BorderoGrupoBoletoService.ts:173-192, 297-337`; `ConciliacaoRetornoService.ts:155-204` |
| Quarantine | Desfechos terminais `RETIRADO`/`INDETERMINADO`/`LIMPEZA_PENDENTE` entregam o grupo à analista; nada mais é tocado automaticamente | ✅ presente | `BorderoGrupoBoletoService.ts:1076-1116, 1319-1328` |
| Repair State | `anotarBaixa` grava `bxaCodSeq` observado no ERP quando a resposta anterior foi perdida; `completarBaixas` grava só o que falta | ✅ presente (com ressalva F-ft-6) | `BorderoGrupoBoletoService.ts:654-692` |

## 4. Findings (achados)

### F-ft-1: Reconhecimento por janela depende de margem fixa de 120s — relógios dessincronizados > 2 min geram um segundo borderô

- **Severidade**: P1
- **Tactic violada**: Reconcile / Timestamp
- **Localização**: `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:484-516`; constante `src/backend/domain/interface/sispag/BorderoGrupoBoletoInterface.ts:13`
- **Evidência (objetiva)**:
  ```
  export const MARGEM_RELOGIO_BORDERO_MS = 120_000;
  ...
  achados = await this.baixa.buscarBorderosNaJanela({
      ...
      t0: exec.escritaIniciadaEm.getTime(),
      agora: this.calendar.now().getTime(),
      margemMs: MARGEM_RELOGIO_BORDERO_MS,
  });
  if (achados.length >= 2) return this.indeterminar(...);
  const [unico] = achados;
  if (!unico) return undefined;   // ← cai para criarBordero
  ```
  A margem é constante absoluta; não há failsafe se o relógio do Render divergir do ERP além de 2 min, nem fallback para "procurar por `usnCodCad` nas últimas N h e marcar `indeterminado` se qualquer borderô do robô na conta/data couber".
- **Impacto técnico**: numa retomada após queda com clock drift > margem, o POST original pode já ter criado o borderô no ERP, a janela não o encontra, e o `criarBordero(retomada=true)` cria um segundo borderô para o mesmo grupo. A guarda `borderoVivoDeOutraExecucao` (`BorderoGrupoBoletoService.ts:297-323`) só pega borderôs vivos de EXECUÇÕES ANTERIORES, não o próprio POST da execução atual quando a janela erra.
- **Impacto de negócio**: duplo-item no `fin015`, remessa com duas linhas J para o mesmo boleto, risco de double-pay. A guarda I16b (segmento J duplicado no `.REM`) é a última linha de defesa (`RemessaService.ts:978-...`), mas atua DEPOIS do finalizar.
- **Métrica de baseline**: 0 ocorrências medidas (feature nunca rodou em PRD); análise estática; a fase HML `retomada` precisa provar explicitamente este cenário.

### F-ft-2: `concluirImport` compara `itsMnyValor` ao `valorBoletoCentavos` mas NÃO revalida `gerNum` nem a conta pagadora do item nativo

- **Severidade**: P2
- **Tactic violada**: Sanity Checking / Comparison
- **Localização**: `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:827-860` (`concluirImport`), `735-774` (`conferirBordero`)
- **Evidência**:
  ```
  const valor = Math.round(item.itsMnyValor * 100);
  if (valor !== grupo.valorBoletoCentavos) { return this.retirar(...) }
  // conta financeira (gerNum) não é relida nem comparada com prep.gerNum
  ```
- **Impacto técnico**: se o ERP ignorar o `gerNum` enviado em `criarBorderoDoGrupo` e usar a conta default do emissor, o borderô acaba associado à conta errada. O total continua certo, a releitura passa, mas a remessa paga do caixa errado.
- **Impacto de negócio**: pagamento de boleto agrupado debitado da conta errada; conciliação do extrato bancário divergente; retrabalho financeiro.
- **Métrica de baseline**: zero evidência de que ocorra; é um gap defensivo. HML `canonico` (6/6) não cobriu troca de conta.

### F-ft-3: `anotarBaixa` grava `valorCentavos` ESPERADO em vez do valor observado no ERP para baixas achadas "a frio" (resposta perdida)

- **Severidade**: P2
- **Tactic violada**: Repair State / Sanity Checking
- **Localização**: `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:681-692`
- **Evidência**:
  ```
  await this.ledger.registrarBaixa(prep.exec.id, {
      docCod: t.docCod, titCod: t.titCod,
      bxaCodSeq: achada.bxaCodSeq,
      valorCentavos: t.valorLiquidoCentavos,   // ← esperado, não observado
  });
  ```
  `listBaixas` (`gravarBaixa` em `732`) traz `bxaMnyValor` do ERP (via `gravarBaixaSimples`), mas a listagem de baixas "existentes" na retomada não o repassa pra cá.
- **Impacto técnico**: se o ERP tiver gravado uma baixa com valor DIFERENTE do esperado (bug de arredondamento, mudança de líquido entre tentativas), a ledger diverge do ERP sem alertar. A conferência `vlrTotalLiquido == valorBoleto` em `conferirBordero` eventualmente pegaria, mas via assinatura agregada, não por baixa.
- **Métrica de baseline**: campo é consumido só na limpeza/auditoria; impacto baixo.

### F-ft-4: Falha ao gravar `registrarBaixa` após baixa ESCRITA no ERP não tem compensação — baixa fica no ERP, ausente do ledger

- **Severidade**: P2
- **Tactic violada**: Repair State / Compensating Transaction
- **Localização**: `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:714-732`
- **Evidência**:
  ```
  const gravada = await this.baixa.gravarBaixaSimples({ ... });
  await this.ledger.registrarBaixa(prep.exec.id, { ..., bxaCodSeq: gravada.bxaCodSeq, ... });
  ```
  Se `registrarBaixa` falhar (DB momentaneamente fora, lock, etc.), a baixa ficou gravada no ERP e o ledger não sabe. Numa retomada, `completarBaixas` relê `listBaixas` e detecta a baixa (`presentes.has`) chamando `anotarBaixa` — ou seja, a retomada CONVERGE. Entretanto, se a execução terminal (`retirar`) ocorrer sem retomada, a limpeza em `excluirBaixasEBordero` passa por `listBaixas` do ERP e exclui tudo — o `doGrupo` do ledger não é usado para RESTRINGIR exclusão, só para detectar `alheias`. OK.
  Mas: entre a chamada `gravarBaixaSimples` com sucesso e a próxima retomada, a baixa fica fora da ledger: um fecho precoce (fim de processo, outro caminho que leia só `exec.baixas`) pode decidir errado.
- **Impacto técnico**: janela estreita de inconsistência DB↔ERP (segundos–minutos até a próxima retomada).
- **Métrica de baseline**: não medida; depende de queda do PG entre `gravarBaixaSimples` e `registrarBaixa`.

### F-ft-5: `FechamentoGrupoBoleto.fecharPago` audita o evento `GRUPO_PAGO` fora da transação `withTransaction` (não há `registrarEvento` após `APLICADO`)

- **Severidade**: P2
- **Tactic violada**: Auditability (invariante de audit trail do CLAUDE/qa-security)
- **Localização**: `src/backend/domain/service/sispag/FechamentoGrupoBoleto.ts:107-134`
- **Evidência**: a função registra `marcarPago` + `encerrarDoGrupo` dentro de `withTransaction` mas NÃO chama `registrarEvento(GRUPO_PAGO, ...)` — não há evento `GRUPO_PAGO` no fluxo. Em contraste, `fecharRejeitado` também não registra `GRUPO_J_REJEITADO` (só `marcarJRejeitado` + alerta); e o diff registra `BORDERO_PREPARADO`, `BORDERO_REAPROVEITADO`, `BORDERO_LIMPO`, `GRUPO_DIVERGENTE`.
- **Impacto técnico**: a trilha do grupo não tem evento terminal `GRUPO_PAGO` ou `GRUPO_J_REJEITADO`. Reconstrução histórica a partir dos eventos do grupo não vê o fecho; depende da coluna `pago_em` em `sispag_grupo_boleto`.
- **Impacto de negócio**: auditoria externa (compliance, forense) precisa cruzar duas fontes para montar o timeline. Cross-ref qa-security.
- **Métrica de baseline**: 2 fechos terminais sem evento equivalente na trilha de só-inclusão.

### F-ft-6: Partial-pay (grupo com parte paga/parte não) não dispara reaper nem bloqueia novo lote automaticamente — depende 100% da analista

- **Severidade**: P2
- **Tactic violada**: Quarantine / Reconcile
- **Localização**: `src/backend/domain/service/sispag/DecisaoStatusLote.ts:125-159`; sem job reaper vinculado
- **Evidência**: `aplicarGrupos` marca `divergencia=true` nos N títulos e emite `SISPAG_BAIXA_DIVERGENTE`. Não há (a) job que listasse diariamente grupos com partial-pay sem decisão humana há mais de N dias, (b) bloqueio automático para impedir que o grupo entre num novo lote enquanto o `borCod` continuar vivo no ERP com estado misto. A regra `boleto-agrupado-sispag` (I21s) exige resolução humana — correto por desenho —, mas sem SLA observável corre risco de ficar "congelado".
- **Impacto técnico**: boleto parcialmente pago fica pendurado indefinidamente até alguém olhar o alerta.
- **Impacto de negócio**: SLA de resolução não é observável; risco de double-pay se analista refizer o grupo sem conferir o `fin010` (porém o fluxo de nova entrada passa por `conferirAntesDaEscrita` + `borderoVivoDeOutraExecucao`, que BLOQUEIA — mitigado).
- **Métrica de baseline**: hoje não há dashboard; precisará do job PRD GT1/GT2 agregando `divergenciaDetalhe == DETALHE_GRUPO_PARCIAL`.

### F-ft-7: Fases HML `falha`, `retomada`, `v7` e medição PRD GT1/GT2 pendentes — o write-ahead está provado APENAS no caminho feliz

- **Severidade**: P1
- **Tactic violada**: Self-Test (prova empírica da tactic de recovery)
- **Localização**: `docs/regis-review/.../\_shared-metrics.md`; `src/backend/jobs/measure-grupo-boleto-prd.ts` (commit `b87d8ab2`, não rodado)
- **Evidência**: `_shared-metrics.md` — "HML (2026-10-26): fase `canonico` 6/6 (borderô 253). `falha`, `retomada`, `v7` e a medição PRD GT1/GT2 PENDENTES."
- **Impacto técnico**: nenhuma prova viva de que:
  (i) o POST `fin010` morto no meio é retomado pela janela sem duplicar borderô (F-ft-1);
  (ii) `recuperarIdentidade` consegue readotar o antigo após `readotarAntigo` falhar;
  (iii) o CNAB v7 (segmento J com `boletoAgrupado`) é aceito pelo banco (Bradesco);
  (iv) a medição em PRD read-only confirma que não existem borderôs legados que o `preflight` da regra I21p(1) considere elegíveis por engano.
- **Impacto de negócio**: ligar o feature flag em PRD sem essas provas é apostar que o caminho de retomada funciona na primeira vez em que for exercido com dinheiro de verdade.
- **Métrica de baseline**: fases concluídas 1/4; prova PRD 0/1.

## 5. Cards Kanban

### [fault-tolerance-1] Endurecer o reconhecimento do borderô pós-queda com fallback após a janela de 120s

- **Problema**
  > `reconhecerPelaJanela` depende de uma margem fixa de 2 min (`MARGEM_RELOGIO_BORDERO_MS = 120_000`). Se a janela não achar nada, o fluxo cria um segundo borderô. Numa retomada com clock drift maior, a tentativa anterior pode ter deixado um borderô vivo que ficará órfão enquanto outro é criado — risco direto de double-pay se a guarda I16b falhar.
- **Melhoria Proposta**
  > Antes de `criarBordero(retomada=true)`, acrescentar uma segunda busca sem limite rígido de janela ("borderôs do `usnCodCad` do robô, na conta e data do lote, em estado `EM_CADASTRO`, não vinculados a outra execução nossa") e, se qualquer resultado aparecer, ir para `indeterminado` com `Alerta` em vez de criar. Alternativamente, aumentar `MARGEM_RELOGIO_BORDERO_MS` para 10 min (NTP típico de VM Render) e aceitar o risco de ambiguidade (`>=2` já cai em `indeterminado`). Documentar o trade-off na ADR-0077. Tactic: Reconcile.
- **Resultado Esperado**
  > Zero cenário de "segundo borderô criado por janela estreita". Métrica em HML `retomada`: provocar drift ≥ 180s entre t0 e a retomada e confirmar `indeterminado` em vez de criar novo.
- **Tactic alvo**: Reconcile / Timestamp
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-1, F-ft-7
- **Métricas de sucesso**:
  - Cobertura HML `retomada` para drift > margem: 0 → 1 cenário provado
  - Borderôs órfãos por drift: potencial N → 0
- **Risco de não fazer**: double-item no `fin015` numa queda real do Render + ERP ocupado; incidente financeiro.
- **Dependências**: fase HML `retomada` do run deste feature.

### [fault-tolerance-2] Provar `falha`, `retomada` e `v7` em HML + rodar medição PRD GT1/GT2 ANTES de ligar o feature flag

- **Problema**
  > O escopo deste review foi do delta inteiro, mas só a fase `canonico` passou. Todos os caminhos de recovery (I21s, I21p, I21q, retomada após queda do processo) estão escritos e tipados mas NÃO foram exercidos ao vivo. Ligar em PRD sem isso é QA-com-usuário.
- **Melhoria Proposta**
  > Executar o roteiro `docs-contexto/.../bordero-grupo-hml-plan.md` fases `falha` e `retomada` com `kill -9` entre `POST fin010` e `registrarBordero`, e entre `gravarBaixaSimples` e `registrarBaixa`; validar `.REM` do CNAB v7 contra o Bradesco de teste; rodar o job `measure-grupo-boleto-prd` read-only por 7 dias; só depois mover o flag `SISPAG_LIVE_WRITE_ENABLED` para PRD. Tactic: Self-Test.
- **Resultado Esperado**
  > Fases HML concluídas 4/4; relatório PRD GT1/GT2 anexado à ADR-0077; `.REM` v7 aceito em sandbox do banco.
- **Tactic alvo**: Self-Test / Reconcile
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-7, F-ft-1
- **Métricas de sucesso**:
  - Fases HML: 1/4 → 4/4
  - Job PRD rodado: 0 → ≥7 dias de observação read-only
- **Risco de não fazer**: incidente financeiro na primeira queda real.
- **Dependências**: janela de HML da Columbia.

### [fault-tolerance-3] Revalidar `gerNum` do item nativo no `concluirImport`

- **Problema**
  > `concluirImport` só compara total; se o ERP ignorar `gerNum` enviado, o borderô vai para conta errada e o fluxo não detecta.
- **Melhoria Proposta**
  > Em `concluirImport`, comparar `item.gerNum ?? ...` contra `prep.gerNum` (ou re-ler o campo da conta financeira do `fin015`) e, divergente, chamar `retirar(prep, R.GRUPO_BOLETO_FALHOU, 'conta financeira do item divergente')`. Tactic: Sanity Checking.
- **Resultado Esperado**
  > Nenhum borderô importado em conta diferente da do lote.
- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-2
- **Métricas de sucesso**:
  - Teste cobrindo `gerNum` divergente: 0 → 1
- **Risco de não fazer**: pagamento debitado da conta errada; conciliação bancária quebrada.
- **Dependências**: —

### [fault-tolerance-4] Usar `bxaMnyValor` observado em `anotarBaixa` em vez do esperado

- **Problema**
  > `anotarBaixa` grava `valorCentavos: t.valorLiquidoCentavos`; divergência real entre ERP e esperado não é observável na trilha.
- **Melhoria Proposta**
  > Trazer `bxaMnyValor` em `baixa.listBaixas` (o cliente já o lê para outras rotinas) e usar o valor observado. Tactic: Repair State.
- **Resultado Esperado**
  > Ledger reflete 100% o estado do ERP para baixas conhecidas.
- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-3
- **Métricas de sucesso**:
  - Fidelidade ledger↔ERP: esperado → observado
- **Risco de não fazer**: trilha diverge em cenários de retomada; investigação de incidente mais trabalhosa.
- **Dependências**: —

### [fault-tolerance-5] Fechar `gravarBaixaSimples` + `registrarBaixa` em transação pg (ou write-ahead da intenção da baixa)

- **Problema**
  > Entre o retorno do ERP e o `UPDATE` da coluna JSON `baixas`, uma queda do PG deixa a baixa só no ERP; a convergência depende de uma próxima retomada e de `listBaixas` consistente.
- **Melhoria Proposta**
  > Gravar uma intenção de baixa (`bxa_intencao_em`) ANTES do `gravarBaixaSimples`, com `(docCod, titCod)`; na retomada, usar o par para reconhecer a baixa escrita pelo ERP mesmo que o UPDATE pós-POST tenha falhado. Tactic: Timestamp / Repair State.
- **Resultado Esperado**
  > Nenhuma baixa escrita no ERP sem registro local do intervalo t0→t1.
- **Tactic alvo**: Timestamp / Repair State
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-4
- **Métricas de sucesso**:
  - Baixas sem write-ahead: potencial N → 0
- **Risco de não fazer**: investigação de incidente mais frágil em caso raro de queda do PG a meio da baixa.
- **Dependências**: ajuste da coluna/migration de `sispag_grupo_boleto_execucao`.

### [fault-tolerance-6] Registrar eventos terminais `GRUPO_PAGO` e `GRUPO_J_REJEITADO` na trilha

- **Problema**
  > A trilha de eventos do grupo cobre `BORDERO_PREPARADO`, `BORDERO_REAPROVEITADO`, `BORDERO_LIMPO`, `GRUPO_DIVERGENTE`, mas o fechamento pago/rejeitado não gera evento — depende de ler `pago_em`/`j_rejeitado_em` em outras tabelas.
- **Melhoria Proposta**
  > Em `FechamentoGrupoBoleto.fecharPago` (dentro da transação) e `fecharRejeitado`, chamar `grupoRepo.registrarEvento({ tipo: GRUPO_PAGO | GRUPO_J_REJEITADO, ... })`. Tactic: Auditability.
- **Resultado Esperado**
  > Timeline do grupo auto-contido a partir de `sispag_grupo_boleto_evento`.
- **Tactic alvo**: Auditability
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-ft-5
- **Métricas de sucesso**:
  - Eventos terminais na trilha: 0 → 2 tipos
- **Risco de não fazer**: reconstrução de histórico forense cruza múltiplas fontes; cross-ref qa-security.
- **Dependências**: ampliar enum `GRUPO_BOLETO_EVENTO`.

### [fault-tolerance-7] Reaper + bloqueio automático para grupos com partial-pay sem decisão humana há > N dias

- **Problema**
  > Grupo partial-paid depende 100% da analista; sem SLA observável, pode permanecer indefinidamente.
- **Melhoria Proposta**
  > Job diário que lista grupos com `divergenciaDetalhe=DETALHE_GRUPO_PARCIAL` e sem alteração humana há > 3 dias, re-emite o alerta com severidade `ERRO`, e marca o grupo com um `bloqueado_por_divergencia_em` que impede entrada em novo lote até a analista limpar. Tactic: Quarantine / Reconcile.
- **Resultado Esperado**
  > Nenhum grupo partial-paid "esquecido" por mais de 3 dias.
- **Tactic alvo**: Quarantine
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-ft-6
- **Métricas de sucesso**:
  - Grupos partial-paid > 3d sem ação: potencial N → 0
- **Risco de não fazer**: boleto parcialmente pago fica fora de controle; risco reputacional.
- **Dependências**: job scheduler (hoje via cron do Render); métrica PRD GT1/GT2.

## 6. Notas do agente

- Escopo estritamente do delta `feat/sispag-boleto-agrupado`; não revisei availability/deployability/modifiability/performance por decisão do run.
- Nenhum P0: o write-ahead está desenhado corretamente (`abrir` com `ON CONFLICT DO NOTHING`, `registrarBordero` idempotente, `registrarEtapa` com optimistic lock, `limpar` com guarda viva do lote nativo, `conciliar` com chave de idempotência + consulta ao `processadoEm` do ERP). Os riscos restantes são defensivos.
- Cross-QA: F-ft-5/F-ft-6 (audit trail) sobrepõem com qa-security; F-ft-7 (reaper) sobrepõe com qa-testability (cenários de reprocessamento modelados mas sem job de SLA observável); F-ft-1/F-ft-2 (timeouts/janela) sobrepõem com qa-availability se este run cobrir.
- Métrica em PRD ausente — a feature nunca rodou com dinheiro real; o maior gap do delta é empírico, não arquitetural (F-ft-7).
