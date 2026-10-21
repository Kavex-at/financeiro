---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-21-1458
agent: qa-fault-tolerance
generated_at: 2026-10-21T18:05:00-03:00
scope: backend
score: 8
findings_count: 7
cards_count: 7
---

# Fault Tolerance — Regis-Review (PR #128, ADR-0075)

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista no painel SISPAG; cron de formação automática; cron de ingestão | (a) duplo clique / retry do `POST /sispag/lotes/por-filial`; (b) falha parcial da leitura `com298/list` ou do grid `fin015`; (c) crash do Node entre "retira título do lote de origem" e "insere no destino" (fluxo `mover`); (d) falha de uma fonte do contexto da situação de pagamento (bloqueios, ajustes, desfecho de boleto) | `LotePagamentoService.criarLotesPorFilial`, `incluirTitulo`, `SituacaoPagamentoService.avaliarVivo`, `IngestaoPagamentosService.tiposDosDocumentos`, migration 0089 | Produção multi-filial em serviço de automação financeira, sem escrita ao vivo no ERP (SISPAG continua em RASCUNHO antes da remessa) | Cada lote por filial é independente — falha de uma filial não desfaz as outras; lote que nasce vazio é descartado; `mover` entra/sai do lote na MESMA transação; fontes indisponíveis não aplicam seus motivos e aparecem em `fontesIndisponiveis`; `modoVinculo` cai em `off` com env inválido; migration 0089 é aditiva e idempotente | 0 pagamentos duplicados, 0 lotes em estado irrecuperável, 100% das fontes falhas registradas, 100% das transições de estado com `versao` otimista; falha de uma fonte não leva um bloqueado por aquela fonte a ser pago (defendido pelos guardas vivos do finalizar/remessa) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Operação multi-escrita com `>1` tabela SEM transação (delta) | 0 (todas as mutações multi-tabela usam `withTransaction`) | 0 | ✅ | `grep -n "withTransaction" src/backend/domain/service/sispag/LotePagamentoService.ts` (linhas 174, 446, 540, 766) |
| `mover` (remove da origem + insere no destino) coberto por transação única | sim (`retirarDaOrigem` recebe `tx` do `withTransaction` do `incluirTitulo`) | sim | ✅ | `LotePagamentoService.ts:446-494`, `:509-529` |
| Advisory lock por título (I3) na inclusão/mover | sim, chave `hash(filCod:docCod:titCod)` | sim | ✅ | `LotePagamentoService.ts:440-443`, `:812-819` |
| Idempotência explícita em endpoint que executa a escrita monetária (remessa, retorno, ingestão) | sim (header `Idempotency-Key` em `/sispag/remessa`, `/sispag/retorno`, ingestão) | sim para write monetário | ✅ | `routes/sispag.ts:1192, 1404, 1564`, `IngestaoPagamentosService.ts:67-72` |
| Idempotência em `POST /sispag/lotes/por-filial` (não monetário, mutação local) | ausente | mitigado por botão desabilitado + regra I3 na inclusão | ⚠️ | `routes/sispag.ts:272-289`; FE `useCriarLotesPorFilial.ts`, `BarraSelecaoLotes.tsx:49-55` |
| Fontes de contexto que falham individualmente (bloqueios, ajustes, boleto, env) com fallback silencioso explícito e `fontesIndisponiveis` | 4/4 | 4/4 | ✅ | `SituacaoPagamentoService.ts:65-82, 86-102` |
| Fail-closed de env inválido para `modoVinculo` | sim (parse → vazio → `OFF`; `liveWriteEnabled=false` → `OFF`) | sim | ✅ | `ModoPorFilial.ts:19-40`, `ModoVinculoCodigoBarras.ts:28-37` |
| Migration do delta aditiva e idempotente (sem rollback necessário) | sim (`ADD COLUMN IF NOT EXISTS tpd_des_nome`) | sim | ✅ | `migrations/0089_sispag_titulo_tipo.sql:14-15` |
| UPSERT da ingestão preserva último valor conhecido quando a fonte falha | sim para `tpd_cod`, `tpd_des_nome`, `forma_pagamento_conexos`; `tem_boleto` sob flag | 100% das colunas de enriquecimento best-effort | ✅ | `TituloAPagarRepository.ts` (COALESCE em `tpd_cod`, `tpd_des_nome`); `IngestaoPagamentosService.ts:155-160, 262-266` |
| Resposta do `com298/list` validada por Zod no boundary | sim | sim | ✅ | `ConexosSispagClient.ts:104-109, 1029-1032` |
| Lote vazio descartado quando nenhum título entrou (`criarLotesPorFilial`) | sim, via `cancelarSeVazio(lote.id).catch(() => false)` | sim, mas sem fallback em caso de falha do próprio DELETE | ⚠️ | `LotePagamentoService.ts:288-291`, repo `cancelarSeVazio` `LotePagamentoRepository.ts:566-575` |
| Auditoria agregada do `criarLotesPorFilial` (ator, títulos pedidos, lotes criados, recusados) | ausente — só `criarLote`/`incluirTitulo` individuais logam `BUSINESS_INFO` | presente | ⚠️ | `LotePagamentoService.ts:238-254` |
| Job de reconciliação periódica da carteira SISPAG contra o `fin015/fin064` do Conexos | ausente (há `validate-situacao-pagamento-v1.ts`, mas é só diagnóstico pontual, somente leitura, sem alerta) | presente | ⚠️ | `jobs/validate-situacao-pagamento-v1.ts:1-104` |
| Backend typecheck / lint / jest no HEAD do PR | 280 suítes, 5.255 testes verdes; 0 lint errors | verde | ✅ | `_shared-metrics.md` seção Gates |

> ⚠️ **Não medível localmente**: taxa de 2xx vs. 5xx do `/lotes/por-filial` em PRD, latência p99 das transações do `incluirTitulo` com advisory lock sob carga concorrente, taxa de "fontes indisponíveis" por rodada em PRD. Requer CloudWatch (ou equivalente no Render, se exposto). Recomendação: contar WARN `situação de pagamento: fonte indisponível, motivos dela não aplicados` por hora por fonte e alertar quando o número for > 0 por mais de 30 min — já é a métrica barata de quebra de contrato.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — sem redundância ativa/passiva de clients (um só `ConexosSispagClient`); não é cenário deste PR. | N/A | — |
| Replacement | N/A — não há "cold spare" no delta. | N/A | — |
| Predictive Model | Ausente — nada prediz falha do `com298/list` ou do grid de pendentes antes dela ocorrer; a detecção é pós-fato (ver Condition Monitoring). | ⚠️ parcial | — |
| Increase Competence Set | Presente — o `SituacaoPagamentoResolver` enumera os 9 motivos de bloqueio e normaliza a UX (motivo + dono + ação); o universo de "estados conhecidos" cresceu. Fonte ausente é tratada como "não sei" explícito, não como "ok". | ✅ | `SituacaoPagamentoResolver.ts:76-126, 283-294` |
| Sanity Checking | Presente — Zod em todas as linhas lidas (`tituloRowSchema`, `tipoDocumentoRowSchema`), `vldPagoEstrito` recusa valor ilegível, `isFilterRejected` só cai no fallback com 400 que *nomeia* o filtro. | ✅ | `ConexosSispagClient.ts:70-109, 117-124, 304-344` |
| Comparison | Presente parcial — `validate-situacao-pagamento-v1.ts` compara soma dos motivos com `BLOQUEADO.qtd` e nomes "PERMUTA" vs. `TIPO_PERMUTA.qtd`. É diagnóstico pontual, não contínuo. | ⚠️ parcial | `jobs/validate-situacao-pagamento-v1.ts:72-93` |
| Timestamp | Presente — `atualizado_em = now()` no UPSERT, `vencimento` em dia civil Brasília (ADR-0070), `diasAteVencimento` recalculado toda avaliação ao vivo. | ✅ | `TituloAPagarRepository.ts:99` (UPSERT); `SituacaoPagamentoService.ts:60-63` |
| Timeout | Herdada — timeouts moram em `ConexosBaseClient.runWithRetry` (pré-existente); o delta não introduz chamadas externas síncronas sem timeout. | ✅ (via herança) | `ConexosSispagClient.ts:457, 502, 538-544` (usa `runWithRetry`) |
| Condition Monitoring | Presente — `IngestaoPagamentosService` registra `BUSINESS_INFO`/`BUSINESS_WARN` por filial com cobertura (`comTipo`, `comBoletoDda`, `bncCodsTentados`), para denunciar quebra de contrato ANTES da remessa. | ✅ | `IngestaoPagamentosService.ts:129-152, 249-260` |
| Self-Test | Ausente contínuo — o `validate-situacao-pagamento-v1.ts` é um probe de validação, mas não roda em cadência; a infraestrutura Lambda alvo (EventBridge) ainda não existe. | ⚠️ parcial | `jobs/validate-situacao-pagamento-v1.ts` |
| Voting | N/A — não há N clientes votando sobre o mesmo título. | N/A | — |
| Redundancy (active/passive/spare) | N/A — a leitura do `fin064` é a única fonte autoritativa. | N/A | — |
| Rollback | Presente — `withTransaction` em `mover`, `atualizarModalidadeItem`, `removerTitulo`, `transicionar`: crash intermediário desfaz. `cancelarSeVazio` desfaz o lote-cabeçalho quando nenhum item entrou. | ✅ | `LotePagamentoService.ts:174, 446, 540, 766`; `:288-291`, `:527` |
| Repair State / Reconcile | Parcial — não há reconciliação periódica da carteira local vs. `fin015`/`fin064`; a `IngestaoPagamentosService` sobrescreve a carteira a cada rodada e `marcarInativosForaDaRun` cobre o anti-fantasma, mas é "a próxima rodada corrige", não "comparar e alertar quando divergente". | ⚠️ parcial | `IngestaoPagamentosService.ts:413-414` |
| Idempotent Replay | Presente para o fluxo monetário (remessa/retorno/ingestão com `Idempotency-Key`); AUSENTE no `/sispag/lotes/por-filial`. A regra I3 (título já em RASCUNHO) + advisory lock cobrem o replay no sentido fraco: um replay cria lote vazio e o `cancelarSeVazio` o descarta. | ⚠️ parcial | `routes/sispag.ts:272-289, 1192, 1404, 1564`; `LotePagamentoService.ts:458-468, 288-291` |
| Compensating Transaction | N/A — nada ainda escreve no ERP neste PR (SISPAG continua em RASCUNHO antes da remessa). O `cancelarSeVazio` é compensação LOCAL, não contra o ERP. | N/A | — |
| Quarantine | Parcial — título com situação `BLOQUEADO` é a quarentena da fila de pagamento (não entra em lote automático, inclusão manual recusa). Fonte indisponível NÃO vira quarentena — vira "motivos daquela fonte não aplicados", decisão explícita documentada. | ⚠️ parcial | `FormacaoLotesService.ts:99-127`; `LotePagamentoService.ts:340-348`; `SituacaoPagamentoService.ts:66-82` |
| Reintroduction (Shadow / State Resync / Escalating Restart) | Shadow herdado do ADR-0071 (`MODO_VINCULO.SHADOW`); State Resync via re-leitura `fin064` autoritativa na inclusão (I2). Escalating restart: N/A (não há cluster). | ✅ (shadow + resync) | `LotePagamentoService.ts:402-423`; `ModoVinculoCodigoBarras.ts:8-13` |

## 4. Findings (achados)

### F-fault-tolerance-1: `exigirSituacaoPagavel` curto-circuita quando o título está fora da carteira persistida

- **Severidade**: P1
- **Tactic violada**: Increase Competence Set (regra única), Sanity Checking (defense in depth)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:332-348`; serviço `SituacaoPagamentoService.ts:177-194` (`avaliarVivo` devolve `null` quando `lerPersistido` não acha o título)
- **Evidência (objetiva)**:
  ```ts
  // LotePagamentoService.ts:336-348
  const situacao = await this.situacaoPagamento.avaliarVivo(
      { filCod: chave.filCod, docCod: chave.docCod, titCod: chave.titCod },
      vivo,
  );
  if (situacao?.estado === ESTADO_PAGAMENTO.BLOQUEADO) {
      throw new TituloNaoElegivelError({ ... });
  }
  // SituacaoPagamentoService.ts:181-182
  const persistido = await this.lerPersistido(chave);
  if (!persistido) return null;
  ```
- **Impacto técnico**: um título que o `fin064` ao vivo devolve como `liberado=true, pago=false` mas que a ingestão NÃO persistiu na carteira (fora da janela de vencimento, exterior, filial não lida na última rodada) escapa das regras ADR-0075 (`TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `VENCIDO`, `BOLETO_SEM_DDA`, `AJUSTE_CENTAVOS_PENDENTE`, `CONFIRMACAO_A_REVISAR`). Os guardas vivos restantes são apenas `getTituloAPagar` (pago/liberado/existe) e o `BloqueioDuplicidadeRepository.findAtivo`. Permuta e forma fora do SISPAG NÃO são cobertas pelos guardas vivos.
- **Impacto de negócio**: analista pode incluir à mão num lote um título "(PERMUTA)" ou com forma `CHEQUE`/`CAIXA` que estava fora da carteira persistida, e só descobre o erro na remessa (ou ao sair do SISPAG apontando para a frente errada). Não é double-pay nem lote irrecuperável; é regra de domínio contornável por caminho secundário.
- **Métrica de baseline**: 1.277 títulos ativos sem `tpd_cod` medidos em PRD em 20/10/2026 (`_shared-metrics.md`) — exatamente a população onde a situação persistida é "não sei" sobre tipo e um retorno `null` do `avaliarVivo` perderia a cobertura.

### F-fault-tolerance-2: Fonte de contexto indisponível silencia o motivo correspondente no caminho de escrita

- **Severidade**: P1
- **Tactic violada**: Sanity Checking (fail-closed na escrita), Quarantine
- **Localização**: `src/backend/domain/service/sispag/SituacaoPagamentoService.ts:66-82, 96-98`; `SituacaoPagamentoResolver.ts:254-281`
- **Evidência (objetiva)**:
  ```ts
  // SituacaoPagamentoService.ts:66-82
  private ler = async <T>(fonte, indisponiveis, leitura) => {
      try { return await leitura(); }
      catch (error) { indisponiveis.push(fonte); /* warn */ return undefined; }
  };
  // SituacaoPagamentoResolver.ts:254-260 — regra se auto-desliga quando a fonte falhou
  if (ctx.desfechos === undefined || t.formaPagamentoConexos !== PAGO_POR_CONEXOS.BOLETO || t.temBoleto === true) {
      return undefined;
  }
  ```
- **Impacto técnico**: na LEITURA do painel a opção é razoável (a tela mostra "situação incompleta" via `fontesIndisponiveis`). Mas `criarLotesPorFilial` e `incluirTitulo` passam pela MESMA avaliação (`avaliarUm`/`avaliarVivo`); uma falha momentânea de `boleto.situacaoPorTitulo()` deixa a regra `BOLETO_SEM_DDA` sem aplicar, e um título que o painel mostraria BLOQUEADO entra como PRONTO. Mitigado downstream por `BoletoSemCodigoBarrasError` na remessa (ADR-0071/ADR-0063), e pela re-leitura ao vivo do flag no import — o pagamento duplicado está defendido, mas a camada de defesa ADR-0075 some sem sinal explícito para quem está escrevendo.
- **Impacto de negócio**: perda temporária de preditividade (lote entra, só é barrado na finalização ou remessa) e, pior, perda silenciosa da trilha "este título entrou mesmo com fonte X indisponível", já que a camada de escrita não propaga `fontesIndisponiveis` do contexto para o resultado da inclusão.
- **Métrica de baseline**: `fontesIndisponiveis` existe no retorno do painel mas NÃO aparece no `CriarLotesPorFilialResult`; qualquer rodada em que a fonte boleto cai durante uma criação por filial é indistinguível de uma rodada verde.

### F-fault-tolerance-3: `POST /sispag/lotes/por-filial` sem `Idempotency-Key`

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay
- **Localização**: `src/backend/routes/sispag.ts:272-289`
- **Evidência (objetiva)**:
  ```ts
  router.post('/lotes/por-filial', exigirPermissao(PERMISSION.SISPAG_EXECUTAR), asyncHandler(async (req, res) => {
      // ... sem leitura de header `Idempotency-Key`
      res.json(await service.criarLotesPorFilial({ ...parsed.data, ator: ator(req) }));
  }));
  ```
- **Impacto técnico**: retry (duplo-clique após timeout TCP, F5 do navegador após 504 do proxy) emite uma SEGUNDA criação. Sem `mover`, a regra I3 recusa todos os títulos → lote nasce vazio → `cancelarSeVazio` o descarta (bom). Com `mover: true`, a segunda chamada CANCELA os lotes criados pela primeira e cria lotes NOVOS com os mesmos títulos — IDs mudam, trilhas mudam de lote. Não é double-execution financeiro (o SISPAG continua RASCUNHO antes da remessa), mas é não-idempotência observável na trilha.
- **Impacto de negócio**: analista pode receber "lote #142 criado" e, após refresh, ver que o lote visível é o #143 com os mesmos títulos — toda referência operacional (print, chat, anotação) ao #142 fica órfã.
- **Métrica de baseline**: 0 endpoints novos no delta aceitam `Idempotency-Key` (meta: 100% para endpoints que criam agregados).
- **Mitigação atual**: FE desabilita o botão enquanto `criando=true` (`BarraSelecaoLotes.tsx:49-55`) e `useCriarLotesPorFilial` previne reentrada (`criando` state), o que cobre o duplo-clique mas não o retry.

### F-fault-tolerance-4: `cancelarSeVazio(...).catch(() => false)` engole a falha do descarte

- **Severidade**: P2
- **Tactic violada**: Repair State (completude), Condition Monitoring (observabilidade da falha)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:288-291`
- **Evidência (objetiva)**:
  ```ts
  if (incluidos.length === 0) {
      await this.repo.cancelarSeVazio(lote.id).catch(() => false);
      return { filCod, resultado: RESULTADO_LOTE_FILIAL.RECUSADO, incluidos, recusados };
  }
  ```
- **Impacto técnico**: se o `UPDATE ... status='CANCELADO'` falhar (ex.: queda de conexão), o lote-cabeçalho permanece em `RASCUNHO` sem nenhum item. Nenhum log é emitido (o `.catch` descarta o erro silenciosamente). Zero chance de causar pagamento duplicado — o lote vazio não finaliza. Cosmético/bookkeeping.
- **Impacto de negócio**: ao longo do tempo, lotes `RASCUNHO` sem itens poluem a lista "Lotes candidatos" até alguém cancelar à mão.
- **Métrica de baseline**: 0 WARN/ERROR emitido quando o descarte falha; esperado: 1 WARN por falha.

### F-fault-tolerance-5: `criarLotesPorFilial` não emite auditoria agregada

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (trilha agregada)
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:238-254`
- **Evidência (objetiva)**: nenhuma chamada a `this.audit(...)` no corpo do `criarLotesPorFilial`; apenas os `criarLote`/`incluirTitulo` internos auditam (um registro por lote criado e um por título incluído, não um registro de "operação X do ator Y pediu N títulos, criou M lotes, recusou K").
- **Impacto técnico**: para investigar uma criação parcial é preciso correlacionar N logs individuais pela proximidade temporal + ator; se dois analistas rodam em janela próxima, as trilhas se cruzam.
- **Impacto de negócio**: aumenta MTTR do analista de plantão em revisão pós-fato (quem pediu o quê, quando).
- **Métrica de baseline**: 0% de operações `criarLotesPorFilial` com log agregado próprio; meta: 100%.

### F-fault-tolerance-6: Ausência de reconciliação contínua carteira local × `fin015/fin064`

- **Severidade**: P2
- **Tactic violada**: Reconcile, Comparison (contínuo)
- **Localização**: `src/backend/jobs/validate-situacao-pagamento-v1.ts:1-104` é só diagnóstico pontual (`process.exit`), não um cron
- **Evidência (objetiva)**:
  ```ts
  // validate-situacao-pagamento-v1.ts:97-103
  main().then(() => process.exit(0)).catch(...);
  ```
- **Impacto técnico**: a carteira local diverge do `fin064` se uma rodada de ingestão não vê uma filial (`filiaisLidas` cobre o anti-fantasma, mas apenas para as filiais lidas na rodada); sem reconciliação contra o `fin015/fin010` do Conexos, uma divergência silenciosa pode persistir até alguém olhar o Conexos. Pré-existente, não introduzido por este PR, mas o próprio delta adiciona um probe (`validate-situacao-pagamento-v1.ts`) que PODERIA ser o esqueleto de uma reconciliação periódica.
- **Impacto de negócio**: tela do SISPAG pode mostrar `PRONTO` para um título que o Conexos já tem em outro status (p.ex. renegociado), e isso só vira sinal no próximo ciclo de ingestão.
- **Métrica de baseline**: 0 jobs de reconciliação periódica; meta: 1 (diário, com alerta quando a divergência excede N títulos).

### F-fault-tolerance-7: `avaliarSituacao` do painel engole a falha com `undefined` sem distinguir "fonte caiu" de "falha de cálculo"

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring (granularidade)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:230-243`
- **Evidência (objetiva)**:
  ```ts
  } catch (error) {
      await this.logService.error({ type: LOG_TYPE.FLOW_ERROR, message: 'SISPAG painel: falha ao calcular a situação de pagamento (painel sem ela)', ... });
      return undefined;
  }
  ```
- **Impacto técnico**: a tela degrada corretamente (sem cards de ação). Mas a diferença entre "banco Postgres caiu" e "resolver lançou por bug" só vem no corpo do log. Baixa prioridade.
- **Impacto de negócio**: pequeno — perda de precisão de triagem.
- **Métrica de baseline**: 1 tipo de log (`FLOW_ERROR`) cobrindo todas as falhas internas da função.

## 5. Cards Kanban

### [fault-tolerance-1] Rejeitar inclusão quando o título está fora da carteira persistida (ou carregar o contexto autoritativo ao vivo)

- **Problema**
  > Em `exigirSituacaoPagavel` (LotePagamentoService.ts:332-348), o retorno `null` de `avaliarVivo` para um título que a ingestão não persistiu faz todo o conjunto de regras ADR-0075 ser pulado. `TIPO_PERMUTA`, `FORMA_NAO_SISPAG`, `VENCIDO` e `BOLETO_SEM_DDA` deixam de barrar inclusões manuais nessa população (1.277 títulos sem `tpd_cod` em PRD em 20/10/2026). Os guardas vivos restantes (pago/liberado/duplicidade) não cobrem permuta nem forma de pagamento inválida.

- **Melhoria Proposta**
  > Trocar o curto-circuito por **Sanity Checking fail-closed**: quando `lerPersistido` devolve `null` para um título cujo `fin064` ao vivo é válido, recusar a inclusão com `TituloNaoElegivelError('fora-da-carteira')` OU, alternativamente, construir o contexto ADR-0075 a partir do `fin064` + leitura ao vivo de `com298/list` (tipo do documento) e do `boleto_dda` para aquele docCod, para que a regra se aplique mesmo sem persistência prévia. A primeira opção é S; a segunda é M e preserva a UX (analista não é bloqueado por "ingestão ainda não rodou").

- **Resultado Esperado**
  > 0 inclusões manuais que escapam de `TIPO_PERMUTA`/`FORMA_NAO_SISPAG`/`VENCIDO`/`BOLETO_SEM_DDA` por título fora da carteira. Novo teste em `LotePagamentoService.test.ts` cobrindo o caso.

- **Tactic alvo**: Sanity Checking (fail-closed), Increase Competence Set
- **Severidade**: P1
- **Esforço estimado**: S (opção A) · M (opção B)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Cobertura das regras ADR-0075 em `incluirTitulo` para títulos fora da carteira: 0% → 100%
  - Teste cobrindo o cenário: ausente → presente
- **Risco de não fazer**: analista inclui à mão um título de permuta (ou com forma `CHEQUE`) via `/sispag/lotes/por-filial` sem bloqueio; só é barrado na remessa (ou pior, só na frente de permutas depois do pagamento).
- **Dependências**: nenhuma.

### [fault-tolerance-2] Propagar `fontesIndisponiveis` para `CriarLotesPorFilialResult` e recusar fail-closed quando a fonte do motivo CRÍTICO caiu

- **Problema**
  > No caminho de escrita (`criarLotesPorFilial` / `incluirTitulo`), uma falha em uma fonte do contexto (bloqueios, ajuste, boleto, env) silencia o motivo correspondente e segue como se o título fosse PRONTO. A UI do painel vê isso via `fontesIndisponiveis`, mas o chamador do `criarLotesPorFilial` não — o retorno não carrega o aviso.

- **Melhoria Proposta**
  > Adicionar `fontesIndisponiveis` ao `CriarLotesPorFilialResult` por lote. Opcionalmente, para fontes que cobrem motivos CRÍTICOS (duplicidade, boleto DDA), aplicar política **Quarantine**: recusa fail-closed enquanto a fonte está indisponível, com motivo `codigo: 'FONTE_INDISPONIVEL'`. Para fontes acessórias (ajuste pendente, confirmação de boleto), seguir com o aviso.

- **Resultado Esperado**
  > Toda chamada `criarLotesPorFilial` emite trilha legível quando opera com contexto degradado. Testar com mock que faz `bloqueioRepo.listAtivos` lançar: o retorno deve conter `fontesIndisponiveis: ['DUPLICIDADE']` (ou recusa, conforme política escolhida).

- **Tactic alvo**: Quarantine, Sanity Checking (fail-closed na escrita), Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Visibilidade de contexto degradado no caminho de escrita: 0% → 100%
  - Fontes classificadas (crítica vs. acessória) com política documentada no ADR-0075: 0/4 → 4/4
- **Risco de não fazer**: silêncio durante janela de instabilidade de uma fonte; o `BoletoSemCodigoBarrasError` da remessa é a última linha de defesa e cobre o pagamento duplicado, mas um lote inteiro passa pela aprovação da analista parecendo verde.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Aceitar `Idempotency-Key` em `POST /sispag/lotes/por-filial`

- **Problema**
  > Endpoint não lê `Idempotency-Key`. Retry (duplo-clique após timeout TCP, F5 pós-504) com `mover: true` CANCELA os lotes criados na primeira tentativa e cria lotes novos com IDs diferentes — qualquer referência operacional ao lote antigo (print, mensagem, anotação) fica órfã.

- **Melhoria Proposta**
  > Honrar `Idempotency-Key` no router (`routes/sispag.ts:272-289`). Persistir `(idempotencyKey, resultadoJson)` em `pagamento_ingestao_run` ou tabela própria `lote_idempotency` (mesma estratégia já usada em remessa/retorno/ingestão). Retornar o resultado anterior em replay, sem reexecutar.

- **Resultado Esperado**
  > Replay do mesmo `Idempotency-Key` devolve o mesmo `CriarLotesPorFilialResult` sem criar lote adicional. Teste em `routes/sispag.test.ts` cobrindo o replay.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Endpoints criadores de agregado SISPAG aceitando `Idempotency-Key`: 3/4 (remessa, retorno, ingestão) → 4/4
  - Trilha de operação estável sob retry: inconsistente → determinística
- **Risco de não fazer**: inconsistência operacional em caminhos de rede instável (recorrente em clientes com proxy corporativo); dívida pequena, mas cumulativa.
- **Dependências**: nenhuma.

### [fault-tolerance-4] Logar WARN quando o descarte do lote vazio falha em `criarLotesPorFilial`

- **Problema**
  > `cancelarSeVazio(lote.id).catch(() => false)` (LotePagamentoService.ts:289) descarta silenciosamente a falha do UPDATE. Em caso de falha, um `RASCUNHO` sem itens persiste e nenhum log é emitido.

- **Melhoria Proposta**
  > Trocar o `.catch(() => false)` por `.catch((e) => { this.logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'criação por filial: falha ao descartar lote vazio', data: { loteId: lote.id, erro: ... } }); return false; })`. Sem alterar a resposta ao cliente.

- **Resultado Esperado**
  > Toda falha de descarte do lote vazio aparece em `BUSINESS_WARN` com o `loteId`; o painel de "Lotes candidatos" para de acumular empty `RASCUNHO` sem rastro.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Observabilidade da falha de descarte: 0 → 1 WARN por falha
- **Risco de não fazer**: baixa; cosmético.
- **Dependências**: nenhuma.

### [fault-tolerance-5] Auditoria agregada do `criarLotesPorFilial`

- **Problema**
  > O serviço não emite um registro `BUSINESS_INFO` próprio da operação (apenas os registros individuais de `criarLote` e `incluirTitulo`). Investigar uma criação parcial exige correlacionar por tempo + ator, especialmente se dois analistas rodam em janela próxima.

- **Melhoria Proposta**
  > Antes do `return`, chamar `this.logService.info({ type: LOG_TYPE.BUSINESS_INFO, message: 'SISPAG lote: criarLotesPorFilial', data: { ator, titulosPedidos, lotesCriados, recusadosPorFilial, mover } })`.

- **Resultado Esperado**
  > Um log por chamada de `criarLotesPorFilial`, com o ator e o resumo; MTTR de triagem pós-fato reduz.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1h)
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - % de operações `criarLotesPorFilial` com log agregado: 0% → 100%
- **Risco de não fazer**: dívida de observabilidade; dor sentida no primeiro incidente.
- **Dependências**: nenhuma.

### [fault-tolerance-6] Promover `validate-situacao-pagamento-v1.ts` a job de reconciliação periódica com alerta

- **Problema**
  > Não existe reconciliação periódica da carteira local contra `fin015/fin064`. A ingestão sobrescreve a carteira a cada rodada, mas não compara nem alerta quando a divergência excede um limite. O `validate-situacao-pagamento-v1.ts` já tem a esqueleto certo (soma de motivos vs. estados).

- **Melhoria Proposta**
  > Promover para job agendado (hoje: cron do Render; alvo: EventBridge quando a infra existir) com cadência diária, saída em formato de métrica (Prometheus/CloudWatch) e alerta quando `semSituacao > 0`, `somaMotivos ≠ bloqueados` ou `nomesPermuta ≠ TIPO_PERMUTA.qtd` em mais de 1% da carteira. Adicionar uma segunda verificação que compara `SELECT COUNT(*) FROM titulo_a_pagar WHERE ativo=TRUE AND pago=FALSE` com `ConexosSispagClient.listTitulosAPagar` agregado por filial — divergência sistemática denuncia drift de contrato.

- **Resultado Esperado**
  > Divergência silenciosa deixa de existir; qualquer uma vira sinal em até 24h.

- **Tactic alvo**: Reconcile, Comparison (contínua), Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Jobs de reconciliação periódica da carteira SISPAG: 0 → 1 (diário)
  - Tempo de detecção de divergência local × ERP: indefinido → ≤ 24h
- **Risco de não fazer**: o painel mente sobre o status de um título entre rodadas de ingestão, o analista baseia decisões num snapshot stale sem saber.
- **Dependências**: definição de SLA de latência da ingestão (cruzar com qa-performance).

### [fault-tolerance-7] Distinguir "fonte caiu" de "falha interna" no `avaliarSituacao` do painel

- **Problema**
  > `SispagPainelService.avaliarSituacao` loga um único tipo de erro (`FLOW_ERROR`) para qualquer falha interna do cálculo, incluindo falhas de infraestrutura (Postgres caiu) e bugs do resolver. A granularidade dificulta triagem.

- **Melhoria Proposta**
  > Dividir o log entre `INFRA_ERROR` (quando o erro tem `code` de pg, timeout de rede, etc.) e `FLOW_ERROR` (resto). Pequeno; defensivo.

- **Resultado Esperado**
  > Triagem de "painel sem situação" por classe de erro, não por `grep` em mensagem.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-7
- **Métricas de sucesso**:
  - Tipos de log distintos para falha do `avaliarSituacao`: 1 → 2
- **Risco de não fazer**: nenhum material.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo restrito ao delta `origin/main..HEAD` conforme instrução; achados pré-existentes (ex.: falta de reconciliação periódica carteira × Conexos) só foram listados quando o delta tangencia (o `validate-situacao-pagamento-v1.ts` adicionado neste PR é o esboço do que falta).
- Cross-QA: **Idempotency-Key no `/lotes/por-filial`** cruza com qa-availability (resiliência a retry) e qa-performance (evitar reprocessamento sob carga); a decisão "fonte indisponível → motivos daquela fonte não aplicados" cruza com qa-testability (precisa de teste cobrindo o cenário fail-closed) e qa-security (auditabilidade: o retorno precisa carregar a trilha de contexto degradado).
- Métrica não medida: taxa de WARN `situação de pagamento: fonte indisponível` por hora em PRD — pedir ao painel de observabilidade (Render log tail) ou ao futuro CloudWatch quando a infra Lambda existir.
- Nenhum P0: o PR não introduz caminho onde um título BLOQUEADO possa ser pago sem passar por um guarda vivo adicional (remessa, finalização, I3 na inclusão); a transação única do `mover` cobre o crash entre remove-e-insert; o `cancelarSeVazio` cobre o lote vazio; `modoVinculo` é fail-closed por parse e por kill-switch.


## Errata do orquestrador (2026-10-21)

A baseline "1.277 títulos" citada para `fault-tolerance-1` / R-1 está **mal atribuída**: 1.277 é o número de títulos
da carteira persistida **sem `tpd_cod`** (medição de 20/10), que estão **na** carteira e portanto são avaliados por
`avaliarVivo`. A população exposta ao `null` é outra: títulos que ainda **não** estão na carteira persistida
(criados no Conexos depois da última ingestão). Essa população não foi medida. A prioridade P1 se mantém pelo
leverage e pelo esforço S, não pelo volume.
