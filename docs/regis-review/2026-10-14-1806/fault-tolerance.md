---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-14-1806
agent: qa-fault-tolerance
generated_at: 2026-10-14T18:30:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review (reduzido, delta `fix/sispag-guarda-codbar-repetido`)

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (ou retry) que gera a remessa de um lote SISPAG | Dois ou mais itens do rascunho nativo carregam o mesmo `itsNumCodbar` (ex.: PEDRONI, 10 títulos x 2 boletos), ou leitura parcial/falha de leitura do ERP | `RemessaService.verificarCodigoBarrasRepetido` (`RemessaService.ts:1049-1129`) e gate 5.1 de `RemessaCnabValidator` (`:237-243`) | Escrita real, lote com rascunho já importado no Conexos; inclui retomada (`retomarDe`) | Abortar antes de `finalizarLote`, deixar o rascunho para diagnóstico e não bloquear retry; rede do `.REM` como segunda barreira | 0 remessas com o mesmo boleto entregues; 0 execuções presas sem diagnóstico |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos até `finalizarLote` cobertos pela guarda | 3/3 (criação nova, retomada `importar`/`finalizar`, retomada `gerar_remessa`); pula só `concluido`, que retorna antes (`RemessaService.ts:629`, `:312`) | 100% | ✅ | leitura do código + testes `retomada não pula a checagem` (i)(ii)(iii) |
| Retry a partir de ledger `status='error'` pós-aborto coberto por teste | 0 de 13 testes novos (todos usam `reconciling`) | >=1 | ❌ | `RemessaService.test.ts` diff, `ledgerOrfao` |
| Leitura em lote com mais de 500 itens | página única, `pageSize: 500`, sem `maxPaginas` (`ConexosSispagWriteClient.ts:612-621`); vizinho `listarTitulosPendentes` pagina até 40 | paginar | ⚠️ | leitura do código |
| Chamadas novas ao ERP em lote sem BOLETO | 0 (`boletos.length === 0` retorna, `:1051-1052`) | 0 | ✅ | teste `lote sem BOLETO não consulta` |
| Falha de leitura (exceção) | propaga, aborta fail-closed, ledger `error` (`:782-791`) | fail-closed | ✅ | `:782` |
| Leitura curta (`lidas < boletos`) | WARN e segue (`:1066-1075`) | WARN aceito pelo desenho | ⚠️ | `:1066` |
| Vazamento do código completo (log, ledger, mensagem) | 0 sítios (só `mascarado` 5+4) | 0 | ✅ | `BoletoCodigoBarrasRepetidoError.ts` |
| Taxa de dados reais flagados pelo ERP (motivação) | 27 títulos em grupos com mais títulos que boletos | n/a | referência | `_shared-metrics.md` |

> Não medível localmente: frequência de lotes com mais de 500 itens e de leituras curtas em produção. Requer contagem em `lote_pagamento_item` e no log `leitura parcial dos códigos de barras`. Recomendação: o WARN já existe; basta contá-lo por semana.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | DV mod-10 dos 3 campos + DV geral mod-11, 47->44; código presente mas inválido falha fechado | ✅ presente | `CodigoBarrasBoleto.ts:paraBarras`, `AnaliseCodigoBarrasRepetido.ts:41-58` |
| Comparison | duas redes independentes: itens do rascunho (pré-finalizar) e segmentos J do `.REM` (pós-geração) | ✅ presente | `RemessaService.ts:625-631`, `:716-725` |
| Condition Monitoring | WARN `BUSINESS_WARN` para leitura parcial; um warn com contagens ao abortar | ⚠️ parcial | `:1066-1075`, `:1118-1128` |
| Timeout / Exception handling | falha de leitura vira `ConexosError` e aborta via `catch` externo | ✅ presente | `ConexosSispagWriteClient.ts:650-652`, `RemessaService.ts:782` |
| Idempotent Replay | guarda é leitura pura, roda antes de `setEtapa('finalizar')`; reexecutar produz o mesmo veredito | ✅ presente | `:629-632` |
| Quarantine | rascunho preservado, nada descartado em silêncio, sem escrita nova no ERP | ✅ presente | `:1049-1129` |
| Repair State / Reintroduction (State Resync) | retomada via `sincronizarComErp` só para ledger `reconciling`; aborto grava `error` e não passa por ela | ⚠️ parcial | `:310`, `RemessaExecucaoRepository.ts:202` |
| Rollback / Compensating Transaction | N/A: o ERP não desfaz import de forma limpa; forward recovery = descartar rascunho no Conexos (documentado na `userMessage`) | N/A | `BoletoCodigoBarrasRepetidoError.ts:montarUserMessage` |
| Redundancy (leitura paginada) | ausente: leitura única de 500 | ❌ ausente | `ConexosSispagWriteClient.ts:612-621` |

## 4. Findings

### F-fault-tolerance-1: retry após aborto não passa por `sincronizarComErp` e re-executa o import sobre rascunho já importado

- **Severidade**: P1
- **Tactic violada**: Reintroduction (State Resync) / Repair State
- **Localização**: `RemessaService.ts:310` (sync só em `reconciling`), `:400` (`flpCodExistente` reaproveitado), `:515-516` + `:588` (`pular('importar')` falso com `retomarDe` indefinido), `:631` (`setEtapa('finalizar')` depois da guarda), `RemessaExecucaoRepository.ts:202`
- **Evidência (objetiva)**:
  ```
  catch (e) { await this.ledger.fail(key, { mensagem }); ... throw e; }   // :782-784 -> status='error', etapa fica 'importar'
  if (anterior && !anterior.dryRun && anterior.status === 'reconciling') { sincronizarComErp }  // :310
  ```
  O aborto da guarda deixa `status='error'` e `etapa='importar'`. A nova tentativa não consulta o ERP (`retomarDe` indefinido), reaproveita o `flpCod` e roda `montarItensImport` de novo. Os 3 testes de retomada da guarda usam `status:'reconciling'`; nenhum cobre o estado real em que o ledger fica depois do aborto.
- **Impacto técnico**: o retry cai primeiro no import, não na guarda. Em HML não foi medido se o grid `titulosPendentes/<flpCod>` ainda lista itens já no rascunho (SEM_GROUND_TRUTH). Se não lista, o retry lança `título ... não está mais elegível ... pode já ter sido pago` (teste existente `:978-986` documenta esse erro). Se lista, reimporta e o item duplica no rascunho, e a guarda aborta de novo. Em ambos os casos é fail-closed (sem pagamento duplo), mas o diagnóstico que a analista recebe é outro.
- **Impacto de negócio**: a analista, depois de remover o título local e pedir "descarte o rascunho", pode ler "já foi pago" e investigar baixa inexistente; retrabalho em lote de 10 títulos como o PEDRONI.
- **Métrica de baseline**: 100% dos retries pós-aborto passam por `status='error'`; 0 de 13 testes novos cobrem esse caminho.

### F-fault-tolerance-2: leitura da guarda é página única de 500 e a leitura curta só gera WARN

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Redundancy
- **Localização**: `ConexosSispagWriteClient.ts:612-621`, `RemessaService.ts:1066-1075`, `:725-737`
- **Evidência (objetiva)**:
  ```
  pageNumber: 1, pageSize: 500   // sem laço de páginas
  if (lidas < boletos.length) { warn(...) }   // segue
  ```
- **Impacto técnico**: um repetido só passa pelas duas redes se (a) o código não estiver legível no item na hora da leitura (linha além da 500, ou item sem `itsNumCodbar`) E (b) o `.REM` não tiver conteúdo legível (`arquivo.conteudo` ausente: gate 5.1 só avisa e segue, `:725-737`). Se o `.REM` vier, o J carrega o código e o gate 5.1 aborta antes de entregar (o lote nativo já está finalizado e o arquivo no ERP, ver F-4). Residual = P(leitura curta) x P(`.REM` sem conteúdo), ambos sem medição. Mascaramento adicional: `lidas` conta qualquer linha com código (inclusive TED/PIX com `itsNumCodbar` residual), então uma linha extra pode compensar um BOLETO não lido e suprimir o WARN.
- **Impacto de negócio**: pagamento em duplicidade de boleto (valor médio por título ~R$ 1.412 no teste canônico) só se as duas condições coincidirem; probabilidade baixa, impacto alto.
- **Métrica de baseline**: cap de leitura = 500 itens; contagem de lotes/semana com `lidas < boletos` não medível localmente.

### F-fault-tolerance-3: `userMessage` do modo `arquivo` afirma que a remessa foi interrompida "antes de finalizar"

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (diagnosticabilidade)
- **Localização**: `BoletoCodigoBarrasRepetidoError.ts` (`orientacao`, compartilhada por `lote` e `arquivo`); gate 5.1 em `RemessaService.ts:716-725`
- **Evidência (objetiva)**: o gate 5.1 roda depois de `finalizarLote` (`:~640`) e `gerarRemessa`; o texto fixo diz `A remessa foi interrompida antes de finalizar`. Nesse ponto o lote nativo está finalizado e o `.REM` existe no ERP.
- **Impacto técnico**: o estado descrito não bate com o real; descartar "rascunho" não existe mais, é preciso cancelar o lote/arquivo finalizado (mesmo caminho do `RemessaCorrompidaError`). O ledger (`erro_mensagem`) tampouco carrega `flpCod` nem a instrução.
- **Impacto de negócio**: o analista busca um rascunho que já virou lote finalizado; risco de alguém reutilizar o arquivo gerado.
- **Métrica de baseline**: 1 de 2 modos da mensagem com orientação factualmente errada.

### F-fault-tolerance-4: gate 5.1 detecta depois de o ERP finalizar; aborto é correto mas o recovery manual não está no ledger

- **Severidade**: P3
- **Tactic violada**: Quarantine
- **Localização**: `RemessaService.ts:716-725`
- **Evidência (objetiva)**: mesmo tratamento tardio de `RemessaCorrompidaError`; `baixarArquivo` não serve o arquivo. Forward recovery documentado só em comentário.
- **Impacto técnico**: sem escrita local de que o lote nativo ficou finalizado com arquivo inválido; reaper de `reconciling` não o enxerga (status `error`).
- **Impacto de negócio**: depende de memória do operador para cancelar o arquivo no Conexos.
- **Métrica de baseline**: 0 itens de runbook para esse estado.

Verificados e sem achado: guarda não roda em dry-run (retorna antes de `beginExecution`, `:440-480`); lote sem BOLETO = 0 chamadas; sem chave de idempotência ou lock novo (guarda só lê); falso positivo: dois boletos distintos nunca compartilham 44 dígitos válidos com DV, e arrecadação (inicia por `8`) já era recusada pelo validador J (`CodigoBarrasBoleto.ts:130`), então não é regressão.

## 5. Cards Kanban

### [fault-tolerance-1] Cobrir e corrigir o retry a partir de ledger `error` pós-aborto da guarda

- **Problema**
  > Depois do aborto da guarda o ledger fica `error` com `etapa='importar'`; o retry não consulta o ERP e re-executa o import sobre rascunho já importado, produzindo erro enganoso ("não está mais elegível") ou item duplicado antes de chegar à guarda.

- **Melhoria Proposta**
  > Gravar `setEtapa(key,'finalizar')` antes da guarda (ou persistir etapa `verificar_codbar`) e tratar `error` com `nativeFlpCod` e etapa >= importar passando por `sincronizarComErp`. Adicionar teste com `buildLedger({status:'error', nativeFlpCod:12, etapa:'importar'})` pós-aborto, afirmando 0 chamadas a `importarTitulos` e a mensagem da guarda.

- **Resultado Esperado**
  > Retry pós-aborto chega à guarda e devolve o mesmo diagnóstico; cobertura do caminho 0 -> 1 testes.

- **Tactic alvo**: Reintroduction (State Resync)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Testes de retry pós-aborto: 0 -> >=2
  - `importarTitulos` chamado no retry pós-aborto: indeterminado -> 0
- **Risco de não fazer**: o ciclo "remover título, descartar rascunho, tentar de novo" continua com mensagem que manda a analista procurar pagamento inexistente.
- **Dependências**: confirmar em HML se `titulosPendentes/<flpCod>` lista itens já no rascunho (define se é erro ou duplicação).

### [fault-tolerance-2] Paginar a leitura da guarda e tornar a leitura curta bloqueante acima de um limiar

- **Problema**
  > A leitura é página única de 500 e `lidas < boletos` só avisa; o `lidas` aceita linhas não-boleto.

- **Melhoria Proposta**
  > Laço de páginas como em `listarTitulosPendentes` (`maxPaginas`), contar `lidas` só sobre itens BOLETO, e decidir com o Yuri o abort em leitura curta já no PR 2. Contar o WARN por semana.

- **Resultado Esperado**
  > Cobertura de leitura 100% dos BOLETO do lote; residual de duplicidade restrito ao caso `.REM` sem conteúdo.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Itens lidos por lote: máx. 500 -> todos
  - WARN de leitura parcial: sem contagem -> contado/semana
- **Risco de não fazer**: lote grande passa sem checagem de rascunho e depende só do `.REM`.
- **Dependências**: nenhuma.

### [fault-tolerance-3] Corrigir a orientação do aborto do gate 5.1 e registrar o estado no ledger

- **Problema**
  > A mensagem do modo `arquivo` diz "antes de finalizar", mas o lote já está finalizado com `.REM` no ERP; o ledger não carrega `flpCod` nem o próximo passo.

- **Melhoria Proposta**
  > Separar a `orientacao` por modo (arquivo: cancelar lote/arquivo no Conexos) e incluir `flpCod` e o próximo passo no `erro_mensagem`; registrar o item no runbook de forward recovery.

- **Resultado Esperado**
  > 2 de 2 modos com orientação correta e diagnosticável só pelo ledger.

- **Tactic alvo**: Quarantine
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Modos com orientação correta: 1/2 -> 2/2
- **Risco de não fazer**: operador reutiliza lote nativo finalizado com arquivo inválido.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo estrito ao delta; ontologia/CHANGELOG não revisados.
- F-1 depende de comportamento do ERP não medido (SEM_GROUND_TRUTH); por isso o card traz a dependência de HML.
- Cross-QA: Testability (retry com ledger `error` sem teste); Availability (leitura sem paginação/timeout próprio); Security (mascaramento 5+4 verificado, sem vazamento).
- O ledger usa `status='error'`, não `failed` como os textos do desenho dizem; ajustar docs.
