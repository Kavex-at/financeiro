---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-05-1645-sispag-excecao-destino
agent: qa-fault-tolerance
generated_at: 2026-10-05T16:45:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista / retry da remessa / job de varredura | Exceção de destino revogada ou substituída no meio de uma retomada de remessa; falha entre dois writes do uso da exceção; duas varreduras concorrentes | `RemessaService` (pin no ledger), `ExcecaoDestinoRepository.transition`, `ExcecaoSubstituicaoService`, job `aposentar-excecoes-substituidas` | Operação normal, com falha parcial (Conexos/Postgres) | Remessa nunca reenvia destino diferente do congelado; transição + trilha atômicas; varredura idempotente; falha vira erro fechado, não envio | 0 envios a destino divergente do pin; 100% das transições com trilha na mesma transação; 0 duplicações em reexecução da varredura |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Transições de estado da exceção com trilha na mesma transação | 3/3 (`transition`, `aprovar`, substituição interna) | 100% | ✅ | `ExcecaoDestinoRepository.ts:203-240,250-300` (`withTransaction`) |
| Transição com guarda otimista (`WHERE estado = $de`) | 1/1 caminho (`sqlTransicao`) + `FOR UPDATE` em `aprovar` | 100% | ✅ | `ExcecaoDestinoRepository.ts:395-405` |
| Pares de writes de uso da exceção em transação única | 0/1 (`setExcecaoDestinoItem` + `marcarUso`) | 1/1 | ❌ | `RemessaService.ts:1190-1207` |
| Divergência do pin (exceção revogada/trocada) falha fechada | 3/3 ramos (`MANUAL`, exceção≠exceção, exceção→cadastro) | 100% | ✅ | `RemessaService.ts:1345-1356`; teste `RemessaService.test.ts:1753` |
| Pin preservado com flags TED/PIX desligadas | sim | sim | ✅ | `RemessaService.ts:1395-1403` |
| Varredura idempotente (reexecução) | sim: `ExcecaoEstadoInvalidoError` vira `aposentada:false` | sim | ✅ | `ExcecaoSubstituicaoService.ts:73-82` |
| Workflow agendado para a varredura | 0 (existem 8 workflows; nenhum chama `aposentar-excecoes-substituidas`) | 1 | ⚠️ | `ls .github/workflows` |
| Trilha da divergência na mesma transação da substituição | 0/1 (best-effort, após o commit) | 1/1 | ⚠️ | `ExcecaoSubstituicaoService.ts:108-131` |
| Recheio do destino entre pré-voo e escrita no `fin015` | não há (janela de uma chamada Conexos) | n/a (medir) | ⚠️ | `RemessaService.ts:1104-1115` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Titularidade lida ao vivo no cadastro e no envio; `DestinoManualValidator`; documento indisponível falha fechado | ✅ presente | `ExcecaoDestinoService.ts:92-100`, `RemessaService.ts:1456-1460` |
| Comparison | Assinatura do ledger (`excecaoId`/`pctCodSeq`/`cixCod`) comparada ao destino atual a cada retomada | ✅ presente | `RemessaService.ts:1343-1356` |
| Timestamp | `cadastrado_em`, `aprovado_em`, `decidido_em`, `substituida_em` + `versao` | ✅ presente | `ExcecaoDestinoRepository.ts:395-405` |
| Timeout | Herdado do `ConexosSispagClient` (fora do delta) | N/A | cross-ref qa-availability |
| Condition Monitoring | `contarPendentesAntigas`, alerta `sispag-excecao-divergencia` | ⚠️ parcial | `ExcecaoDestinoRepository.ts:366`; sem varredura agendada |
| Recovery (forward) | Falha do pin vira `DestinoCongeladoError`; nada é desfeito no Conexos (sem undo no `fin015`), escolha explícita | ✅ presente | `RemessaService.ts:1330-1337` |
| Reintroduction / State Resync | Retomada refaz o resolve ao vivo e confere contra o pin | ✅ presente | `RemessaService.ts:1385-1406` |
| Rollback | Transação PG cobre estado + trilha | ✅ presente | `ExcecaoDestinoRepository.ts:203-240` |
| Idempotent Replay | Varredura e `registrarUsoDaExcecao` (guarda por `item.excecaoDestinoId`) | ⚠️ parcial | F-fault-tolerance-1 |
| Compensating Transaction | Ausente por desenho (Conexos não desfaz; cadastro nunca é escrito pela feature) | N/A | `ExcecaoDestinoService.ts` docstring: "Nunca escreve no cmn025" |
| Reconcile | Sweep reconcilia `APROVADA` x cadastro vivo; sem agendamento | ⚠️ parcial | F-fault-tolerance-3 |
| Quarantine | `PENDENTE` só vira `APROVADA` por outro usuário; item divergente barra a retomada | ✅ presente | `ExcecaoDestinoRule`, `RemessaService.ts:1352` |

## 4. Findings

### F-fault-tolerance-1: Uso da exceção grava vínculo e trilha em dois writes sem transação, e a guarda de idempotência apaga a trilha após falha parcial

- **Severidade**: P1
- **Tactic violada**: Idempotent Replay / Rollback
- **Localização**: `src/backend/domain/service/sispag/RemessaService.ts:1190-1207`; `ExcecaoDestinoRepository.ts:376-386`
- **Evidência (objetiva)**:
  ```
  if (item.excecaoDestinoId === d.excecaoId) return;   // guarda
  await this.loteRepo.setExcecaoDestinoItem({...});     // write 1 (commit)
  await this.excecoes.marcarUso({...});                 // write 2 (appendAudit, outro commit)
  ```
  Se o write 2 falha, a retomada lê `item.excecaoDestinoId` já preenchido e retorna: o evento `USO` nunca é gravado.
- **Impacto técnico**: item aponta para a exceção sem evento `USO`; o invariante de trilha (quem/quando/o quê) quebra de forma silenciosa e permanente. `setExcecaoDestinoItem` já aceita `tx`.
- **Impacto de negócio**: pagamento por destino digitado sem a prova de uso para auditoria.
- **Métrica de baseline**: 2 writes em 0 transações (alvo 1 transação); janela de falha = 1 chamada ao Postgres por item de exceção.

### F-fault-tolerance-2: Revogação ou troca da exceção entre o pré-voo e a escrita no `fin015` não é reconferida

- **Severidade**: P2
- **Tactic violada**: Comparison / Timestamp
- **Localização**: `RemessaService.ts:1104-1115` (escrita) vs `:1385-1406` (pré-voo)
- **Evidência (objetiva)**: o pré-voo resolve e confere o pin antes do `criarLote`; nenhum recheio do estado `APROVADA` ocorre antes do write externo. Revogação durante a retomada, antes do pré-voo, é bloqueada (`aplicarFixado`, teste `RemessaService.test.ts:1753`). A janela remanescente é a duração do lote de chamadas Conexos.
- **Impacto técnico**: uma revogação nessa janela ainda envia o destino revogado; sem undo no Conexos.
- **Impacto de negócio**: risco baixo e raro (revogação concorrente com envio), mas é pagamento irreversível.
- **Métrica de baseline**: janela não medida (⚠️); sem contagem de ocorrências. Rebaixado de P1 por falta de número.

### F-fault-tolerance-3: Varredura de aposentadoria sem agendamento

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring / Reconcile
- **Localização**: `src/backend/jobs/aposentar-excecoes-substituidas.ts` (docstring: "hoje não há workflow"); `.github/workflows/` (8 arquivos, nenhum referencia o job)
- **Evidência (objetiva)**: `grep -rln aposentar-excecoes .github package.json` retorna vazio.
- **Impacto técnico**: a aposentadoria só ocorre no finalizar/envio; exceção de favorecido que sumiu dos lotes fica `APROVADA` indefinidamente (stuck state) e o alerta de divergência não dispara.
- **Impacto de negócio**: exceção obsoleta fica ativa e pode ser usada quando o favorecido voltar.
- **Métrica de baseline**: 0 execuções agendadas por dia (alvo 1/dia, alinhado a `reaper-sispag.yml`).

### F-fault-tolerance-4: Trilha da divergência é best-effort fora da transação da substituição

- **Severidade**: P3
- **Tactic violada**: Rollback
- **Localização**: `ExcecaoSubstituicaoService.ts:93-131`
- **Evidência (objetiva)**: `transition` commita `SUBSTITUICAO` com `divergiu:true`; `DIVERGENCIA_CADASTRO` é gravado depois, com `catch` que só loga. O flag `divergiu` permanece na transição, então a perda é parcial (só os valores mascarados).
- **Impacto técnico**: perda possível do detalhe mascarado da divergência; o alerta segue.
- **Impacto de negócio**: pequeno; escolha documentada (I5).
- **Métrica de baseline**: 1 write fora da transação; sem ocorrência medida.

## 5. Cards Kanban

### [fault-tolerance-1] Gravar vínculo do item e evento USO na mesma transação

- **Problema**
  > `registrarUsoDaExcecao` faz `setExcecaoDestinoItem` e `marcarUso` em commits separados; a guarda de idempotência faz a retomada pular o `USO` perdido.
- **Melhoria Proposta**
  > Expor `marcarUso(…, tx)` e envolver os dois writes em `databaseClient.withTransaction`. Tactic: Rollback + Idempotent Replay. Tocar `RemessaService.ts`, `ExcecaoDestinoRepository.ts`. Teste: falha injetada no segundo write, retomada deve regravar ambos.
- **Resultado Esperado**
  > 2 writes / 0 transações → 1 transação; 0 itens com `excecao_destino_id` sem evento `USO`.
- **Tactic alvo**: Idempotent Replay
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Writes de uso em transação: 0/1 → 1/1
- **Risco de não fazer**: lacuna de trilha silenciosa e permanente em pagamento por exceção.
- **Dependências**: nenhuma

### [fault-tolerance-2] Agendar a varredura de aposentadoria

- **Problema**
  > O job existe mas não há workflow; exceções órfãs ficam `APROVADA` sem revisão.
- **Melhoria Proposta**
  > Criar `aposentar-excecoes-substituidas.yml` diário, no molde de `reaper-sispag.yml`, com os secrets Conexos atualizados (ver memória sobre secrets desatualizados); tratar run com 0 inspecionadas como alerta, não sucesso.
- **Resultado Esperado**
  > 0 → 1 execução/dia; exceção órfã aposentada em ≤ 24h.
- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Execuções agendadas/dia: 0 → 1
- **Risco de não fazer**: exceções obsoletas permanecem usáveis por tempo indefinido.
- **Dependências**: secrets do GH Actions

### [fault-tolerance-3] Reconferir o estado da exceção imediatamente antes do write no fin015

- **Problema**
  > Entre o pré-voo e a escrita há uma janela em que uma revogação não é vista; o envio é irreversível.
- **Melhoria Proposta**
  > Reler `findAprovada` por item de exceção logo antes de `criarLote`/importação (Comparison), falhando fechado como `DestinoCongeladoError`; opcionalmente anexar a trilha de divergência à transação da substituição (F-fault-tolerance-4).
- **Resultado Esperado**
  > Janela de revogação não vista: 1 lote de chamadas → 1 leitura de banco; medir antes com contador de logs.
- **Tactic alvo**: Comparison
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Envios com exceção já revogada: não medido → 0 (contador de negação)
- **Risco de não fazer**: pagamento a destino revogado, sem desfazer.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: ledger EXCECAO, transição+trilha, varredura. Atomicidade de estado+trilha é sólida (`withTransaction` + guarda `WHERE estado=$de` + `FOR UPDATE` no aprovar).
- Troca da exceção (nova aprovação) durante retomada também bloqueia fechado (excecaoId diferente do pin); o reprocesso é manual, sem runbook (P3, não carded).
- Nenhum P0: não achei double-execution nem escrita sem pin; F2 sem baseline rebaixado.
- Cross-QA: trilha e USO (Security/auditabilidade); teste da falha parcial e da revogação concorrente (Testability); workflow e secrets (Deployability/Availability).
