---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-22-2209
agent: qa-fault-tolerance
generated_at: 2026-09-22T22:09:00Z
scope: backend
score: 8.6
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG (via UI) ou duplo-clique/retry de rede no botão "Retirar do lote" | `POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote` chega duas vezes (rede instável, double-click, retry do fetch) para o mesmo título | `LotePagamentoService.retirarDoLote`, `lote_pagamento_item`, `titulo_retencao_formacao` | Runtime normal (sem SQS/ERP nesta feature) | A 1ª chamada remove o item do lote e grava a retenção numa única transação; a 2ª chamada não duplica a remoção nem a retenção — recusa com `TituloForaDeLoteError` (409) porque o item já não está em nenhum lote RASCUNHO | 0 remoções duplicadas, 0 retenções duplicadas (garantido pelo índice parcial `uq_titulo_retencao_formacao_ativa` + `SELECT ... FOR UPDATE` em `lerEstadoParaEdicao`), 100% dos cenários de corrida cobertos por teste (7/7 nesta suíte) |

> Escopo desta feature (ADR-0050): tabela própria com soft delete, sem escrita no ERP e sem
> cálculo monetário (confirmado em `_shared-metrics.md`). O cenário acima é o equivalente, nesta
> fatia, ao "double-booking" que a missão pede para as frentes que movem dinheiro — aqui o que
> não pode duplicar é o efeito colateral que a formação automática lê no cron seguinte.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas multi-tabela do delta cobertas por transação (`withTransaction`/`withAdvisoryLock`) | 4/4 (`removerItemDoLote`, `retirarDoLote`→mesmo método, `liberarRetencao`, `incluirTitulo` — libera retenção na mesma tx) | 100% | ✅ | `src/backend/domain/service/sispag/LotePagamentoService.ts:233-280,464-491,345-353` |
| Endpoints POST/DELETE novos do delta com proteção contra dupla-execução no servidor (constraint/lock, não só UI) | 2/2 (`retirar-do-lote`, `DELETE .../retencao`) | 100% para escritas do delta | ✅ | `src/backend/domain/repository/sispag/RetencaoFormacaoRepository.ts:55-90` (índice parcial + `WHERE removido_em IS NULL`) |
| Cenários de corrida/TOCTOU cobertos por teste no delta | 7 (`item que já não estava…`, `item sumiu entre a busca e o lock…`, `falha ao gravar a retenção propaga…`, `lote que saiu de RASCUNHO entre a leitura e o lock…`, `sem retenção ativa…`, `insertAtiva idempotente sobre o índice parcial`, `incluirTitulo libera a retenção na MESMA transação`) | — (qualitativo) | ✅ | `src/backend/domain/service/sispag/LotePagamentoService.test.ts:592-746`, `RetencaoFormacaoRepository.test.ts:78-111` |
| Ação de escrita do delta com log estruturado (`LogService.info`, `BUSINESS_INFO`) | 2/2 (`retirarDoLote`, `liberarRetencao`) + as pré-existentes via `audit()` | 100% | ✅ | `src/backend/domain/service/sispag/LotePagamentoService.ts:333-359` |
| Ação de escrita do delta com registro **persistido** (tabela dedicada) equivalente a audit-trail | 2/2 — mas via `titulo_retencao_formacao.marcado_por/marcado_em/removido_por/removido_em`, não uma tabela de auditoria genérica | 100% de trilha *persistida* consultável | ⚠️ | `src/backend/migrations/0062_titulo_retencao_formacao.sql:24-34` |
| Chamadas de `LogService.info/success` (trilha "audit") no backend inteiro que caem só em `process.stdout`, sem tabela de auditoria dedicada | 22 arquivos de serviço (`grep -rl`) | 0 fluxo de auditoria crítico sem persistência em tabela | ⚠️ pré-existente, fora do delta | `src/backend/domain/service/LogService.ts:20-26` (`process.stdout.write`) |
| Migration 0062 idempotente (re-execução segura) | Testado explicitamente (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, sem DML) | 100% | ✅ | `src/backend/migrations/retencaoFormacao.test.ts:17,32,49` |
| SQS / ERP / reconciliação envolvidos nesta feature | 0 (feature 100% interna ao Postgres) | N/A | N/A | `_shared-metrics.md:8` ("Nenhuma escrita no ERP, nenhum cálculo monetário") |

> ⚠️ **Não medível localmente**: comportamento sob falha real de rede intermitente do Postgres
> (partição durante o `COMMIT` do `withTransaction`) — requer ambiente de staging com fault
> injection. A garantia atual é lógica (SQL atômico + constraint), não testada sob falha de I/O.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Avoid Faults — Increase Competence Set** | `SELECT ... FOR UPDATE` em `lerEstadoParaEdicao` fecha a janela entre checagem de status e escrita; `getTituloAPagar` fora do lock evita starvation do pool (pré-existente, reaproveitado) | ✅ presente | `LotePagamentoRepository.ts:157-176` |
| **Avoid Faults — Substitution/Replacement** | N/A — feature não tem fallback de provedor externo (não integra ERP) | N/A | justificativa: escopo é 100% Postgres próprio |
| **Detect Faults — Sanity Checking** | Zod nos boundaries HTTP novos (`chaveTituloSchema`, `retirarDoLoteSchema`) valida `filCod`/`docCod`/`titCod`/`motivo` antes de chegar ao serviço | ✅ presente | `src/backend/routes/sispag.ts` (schemas novos, `chave.success`/`corpo.success`) |
| **Detect Faults — Condition Monitoring** | Constraint `titulo_retencao_formacao_remocao_pareada` (CHECK) impede estado inconsistente (`removido_em` sem `removido_por`) mesmo se um bug de aplicação tentar gravar parcial | ✅ presente | `0062_titulo_retencao_formacao.sql:44-47` |
| **Detect Faults — Comparison/Voting** | N/A — sem redundância de fontes nesta feature | N/A | justificativa: não há segunda fonte de verdade para retenção |
| **Contain Faults — Redundancy** | Índice único parcial (`uq_titulo_retencao_formacao_ativa`) é o árbitro de concorrência para `insertAtiva`, dispensando lock explícito nesse caminho | ✅ presente | `RetencaoFormacaoRepository.ts:52-71` |
| **Contain Faults — Recovery (Rollback)** | `withTransaction` garante que falha em `retencaoRepo.insertAtiva` desfaz a remoção do item já feita na mesma transação — testado explicitamente | ✅ presente | `LotePagamentoService.test.ts:696-707` ("a transação desfaz a remoção") |
| **Recover State — Idempotent Replay** | `insertAtiva` usa `ON CONFLICT ... DO NOTHING` sobre o índice parcial: reenvio da mesma mensagem/clique não duplica a retenção | ✅ presente | `RetencaoFormacaoRepository.ts:59-71` + teste `idempotente sobre o índice parcial` |
| **Recover State — Compensating Transaction** | Não se aplica no sentido clássico (não há escrita externa a compensar); a "compensação" de uma retenção é a ação simétrica `liberarRetencao`, explicitamente modelada (ADR-0050 D5) | ✅ presente (via ação simétrica, não rollback de terceiro) | `LotePagamentoService.ts:341-360` |
| **Recover State — Quarantine / Escalation ao analista** | Erros de estado (`TituloForaDeLoteError`, `RetencaoInexistenteError`, `LoteEstadoInvalidoError`) voltam como HTTP 409/404 com `userMessage` acionável — a tela recarrega e mostra o estado atual, sem mascarar a falha | ✅ presente | `src/backend/domain/errors/TituloForaDeLoteError.ts`, `RetencaoInexistenteError.ts` |
| **Recover State — Reconcile** | N/A para esta fatia (não há segunda fonte externa a reconciliar); a "reconciliação" de fato é a query `NOT EXISTS` da formação automática, que já lê o estado atual da retenção a cada rodada | ✅ presente (mecanismo equivalente) | `TituloAPagarRepository.ts` (`listElegiveisParaFormacao`, `NOT EXISTS ... titulo_retencao_formacao`) |
| **Recover State — Audit trail persistido (invariante cross-cutting da proposta)** | Ação fica gravada em `titulo_retencao_formacao` (quem/quando/porquê da retenção) — mas o *log* de auditoria genérico (`this.audit()`/`logService.info`) usado pelas outras ações do serviço continua só em stdout, não em tabela | ⚠️ parcial | `LogService.ts:20-26` vs. `0062_titulo_retencao_formacao.sql` |

## 4. Findings (achados)

### F-fault-tolerance-1: Rollback testado e correto no caminho principal do delta (positivo, sem ação)

- **Severidade**: N/A (nota positiva, não é card)
- **Tactic violada**: nenhuma — tactic *Recovery (Rollback)* está corretamente implementada
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:464-491`, teste em `LotePagamentoService.test.ts:696-707`
- **Evidência (objetiva)**:
  ```ts
  this.db.withTransaction(async (tx) => {
      const { automatico } = await this.travarRascunho(loteId, tx);
      const removidos = await this.repo.removerItem({ loteId, ...chave }, tx);
      ...
      if (reter) await this.retencaoRepo.insertAtiva(tx, { ... }); // se falhar, ROLLBACK desfaz o removerItem
  });
  ```
  Teste: `'falha ao gravar a retenção propaga (a transação desfaz a remoção)'` — `expect(repo.tocarLote).not.toHaveBeenCalled()`.
- **Impacto técnico**: nenhum — cenário coberto corretamente.
- **Impacto de negócio**: nenhum — evita exatamente o cenário que a própria migration documenta como risco ("título fora do lote sem retenção voltaria no próximo cron").
- **Métrica de baseline**: 1/1 cenário de falha parcial no `retirarDoLote` coberto por teste dedicado.

### F-fault-tolerance-2: Audit trail da ação segue padrão só-stdout do resto do serviço (pré-existente, fora do delta)

- **Severidade**: P2 (rebaixado de P1 por ser padrão sistêmico pré-existente, sem baseline de incidente; instrução do run exige baseline numérico para P0/P1)
- **Tactic violada**: Recover State — Audit trail persistido / invariante cross-cutting de auditoria da proposta
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:532-542` (`private audit = ... this.logService.info(...)`); mesmo padrão em 22 arquivos de `domain/service/**` (pré-existente)
- **Evidência (objetiva)**:
  ```ts
  // LogService.ts
  private writeLog = async (input: CreateLogInput): Promise<void> => {
      ...
      process.stdout.write(`${JSON.stringify(logBody)}\n`);
  };
  ```
  `grep -rl "logService\.info\|logService\.success" src/backend/domain/service --include="*.ts" | grep -v test | wc -l` → **22** arquivos; nenhuma tabela `audit_log`/`audit` existe em `src/backend/migrations/` (`grep` vazio).
- **Impacto técnico**: a única trilha *persistida e consultável* de quem/quando fez `criarLote`, `atualizarContaPagadora`, `atualizarModalidadeItem`, `finalizarLote`/`reabrirLote`/`cancelarLote` é o stdout (capturado pelo host de deploy, sem índice por ator/lote/ação). `retirarDoLote`/`liberarRetencao` (delta) têm uma trilha melhor que a média — ficam gravados em `titulo_retencao_formacao` com `marcado_por`/`removido_por` — mas as demais transições do MESMO agregado (`finalizarLote`, `cancelarLote`) não.
- **Impacto de negócio**: se um analista disputar "quem finalizou este lote e quando", a resposta depende de busca em log de aplicação (Render), não de uma consulta SQL confiável — mais lento e mais frágil sob rotação/retention de log. Overlap com Security (auditabilidade) — ver seção 6.
- **Métrica de baseline**: 22/22 serviços do backend usam `LogService` (stdout-only) para a trilha "audit"; 0 tabela de auditoria genérica existe no schema. **Este finding preexiste ao delta e não é P0/P1 desta feature** — o delta, aliás, melhora parcialmente o padrão ao criar uma tabela dedicada para a própria ação de retenção.

### F-fault-tolerance-3: Janela de duplo-clique no frontend entre o clique e a atualização de `salvando`/`busy` (baixo risco, mitigado no backend)

- **Severidade**: P3
- **Tactic violada**: Detect Faults — Condition Monitoring (camada UI)
- **Localização**: `src/frontend/app/sispag/components/RetirarDoLoteDialog.tsx:125-128`, `src/frontend/app/sispag/page.tsx:799-889` (`disabled={busy || salvandoRetencao}`)
- **Evidência (objetiva)**: `setSalvandoRetencao(true)` roda dentro de `confirmarRetirada`, então há uma janela (um tick de render) em que dois cliques rápidos antes do primeiro `setState` aplicar poderiam dispersar duas requisições HTTP.
- **Impacto técnico**: no pior caso gera uma segunda requisição concorrente; o servidor já a resolve corretamente (índice parcial + `FOR UPDATE` — ver F-fault-tolerance-1), então o resultado observável é, no máximo, um segundo toast de erro (`TituloForaDeLoteError` 409), não uma duplicação de dado.
- **Impacto de negócio**: nenhum dado incorreto; possível confusão momentânea do analista com um toast de erro após um clique duplo.
- **Métrica de baseline**: não medido em produção (sem telemetria de clique duplo); risco teórico, mitigado pelo servidor.

### F-fault-tolerance-4: Escopo da feature não inclui reprocessamento assíncrono nem DLQ — não medível/aplicável (nota de escopo)

- **Severidade**: N/A (declaração de não-aplicabilidade, não card)
- **Tactic violada**: nenhuma
- **Localização**: N/A
- **Evidência (objetiva)**: `_shared-metrics.md` confirma "Nenhuma escrita no ERP, nenhum cálculo monetário"; `git diff --stat` do delta não toca `src/backend/lambda/job/`, SQS, ou clients externos.
- **Impacto técnico**: os itens B.1 (SQS dedupe), C.6 (timeouts em client externo), C.9 (reconciliação Conexos) e D.10/D.11 (DLQ) do plano de inspeção **não se aplicam a este delta** — pertencem a outras fatias do SISPAG (ingestão, remessa, conciliação de retorno) já entregues em ciclos anteriores.
- **Impacto de negócio**: nenhum diretamente atribuível a este delta.
- **Métrica de baseline**: N/A.

## 5. Cards Kanban

### [fault-tolerance-1] Persistir a trilha de auditoria das transições de lote em tabela consultável

- **Problema**
  > As transições do lote (`criarLote`, `atualizarContaPagadora`, `atualizarModalidadeItem`, `finalizarLote`/`reabrirLote`/`cancelarLote`) só deixam rastro em `process.stdout` via `LogService`, sem tabela de auditoria — 22 serviços do backend replicam o mesmo padrão. O próprio delta desta feature mostra a alternativa melhor (tabela dedicada com `marcado_por`/`removido_por` para retenção), mas não a generaliza para as demais ações do mesmo agregado.

- **Melhoria Proposta**
  > Modelar uma tabela de auditoria genérica (ou reaproveitar o padrão de `titulo_retencao_formacao` para outras ações-chave do SISPAG) via `/feature-new`, cobrindo ao menos as transições de status do lote (`finalizarLote`, `cancelarLote`) e `atualizarContaPagadora`. Tactic alvo: **Recover State — persisted audit trail**. Arquivos: `LotePagamentoService.ts` (método `audit`), nova migration + repositório.

- **Resultado Esperado**
  > Consulta SQL confiável de "quem fez o quê, quando" para as ações críticas do lote, sem depender de retenção/rotação de log de aplicação. Métrica: 22/22 → 0 serviços críticos sem trilha persistida de auditoria (ou justificativa explícita por serviço de por que stdout basta).

- **Tactic alvo**: Recover State — Audit trail / Repair State
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — depende de quantas ações do domínio financeiro entram no escopo
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Serviços com trilha "audit" só em stdout: 22 → alvo definido por `/feature-new` (não necessariamente 0, mas explícito)
  - Consulta SQL de auditoria disponível para lote SISPAG: não existe → existe
- **Risco de não fazer**: em uma disputa ou investigação de incidente daqui a 6 meses, reconstituir "quem finalizou este lote" depende de busca em log do Render sem índice — mais lento, sujeito a rotação/perda de log.
- **Dependências**: nenhuma; pode ser feito independente deste delta.

### [fault-tolerance-2] Registrar teste de fault injection para falha de I/O do Postgres durante `withTransaction`

- **Problema**
  > A garantia de atomicidade do `retirarDoLote` é validada com mocks (erro síncrono do repositório), não com uma falha real de rede/I/O durante o `COMMIT`. O comportamento sob partição de rede do Postgres não é medível localmente hoje.

- **Melhoria Proposta**
  > Cross-QA com Testability: adicionar um teste de integração (ambiente com Postgres real/testcontainer) que mate a conexão no meio do `COMMIT` de `withTransaction` e confirme que a transação fica de fato revertida (nenhum item removido, nenhuma retenção parcial). Tactic alvo: **Detect Faults — Self-Test / Condition Monitoring** aplicado ao pipeline de CI.

- **Resultado Esperado**
  > Confiança empírica (não só lógica) de que o `ROLLBACK` do driver `pg` cobre falha de I/O, não só exceção de aplicação. Métrica: 0 → 1 teste de fault injection para o caminho `retirarDoLote`.

- **Tactic alvo**: Detect Faults — Self-Test
- **Severidade**: P3
- **Esforço estimado**: M (2-5d) — requer infraestrutura de teste com Postgres real
- **Findings relacionados**: F-fault-tolerance-1 (fortalece a garantia já demonstrada)
- **Métricas de sucesso**:
  - Testes de fault injection de I/O no `withTransaction`: 0 → ≥1
- **Risco de não fazer**: baixo — o driver `pg` e o padrão `BEGIN/COMMIT/ROLLBACK` são bem estabelecidos; risco residual é teórico.
- **Dependências**: infraestrutura de teste com Postgres (testcontainers ou similar) — hoje ausente no repo.

### [fault-tolerance-3] Reduzir a janela de duplo-clique no frontend com desabilitação síncrona (opcional)

- **Problema**
  > `salvandoRetencao`/`busy` são setados dentro da função assíncrona, deixando uma janela de um tick de render em que um duplo-clique rápido pode disparar duas requisições. O backend já neutraliza o efeito (F-fault-tolerance-1), mas o usuário pode ver um toast de erro espúrio.

- **Melhoria Proposta**
  > Usar um ref síncrono (`useRef<boolean>`) checado e setado antes do primeiro `await`, ou desabilitar o botão via `event.currentTarget.disabled = true` no handler de clique, antes do `setState` assíncrono. Tactic alvo: **Detect Faults — Condition Monitoring** na camada de UI.

- **Resultado Esperado**
  > Zero requisições duplicadas originadas por duplo-clique, mesmo antes do primeiro re-render. Métrica: janela de corrida no clique — presente → eliminada.

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Requisições duplicadas por duplo-clique em teste manual: possível (teórico) → eliminado
- **Risco de não fazer**: mínimo — o servidor já garante integridade; o único custo é UX (toast de erro ocasional).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo do delta é deliberadamente pequeno para fault tolerance: sem SQS, sem escrita no ERP,
  sem cálculo monetário (confirmado em `_shared-metrics.md`). Por isso boa parte do plano de
  inspeção da missão (DLQ, reconciliação Conexos, timeouts de client externo, stuck-state reaper)
  foi marcada N/A/não-aplicável a este delta especificamente, não "ausente" — não confundir no
  KANBAN consolidado.
- F-fault-tolerance-2 (audit trail só em stdout) é sistêmico e pré-existente (22 serviços); mantive
  em P2 por instrução do run (P0/P1 exige baseline numérico de incidente, que não tenho). Alertar
  o `qa-security` — a mesma lacuna é relevante para auditabilidade (Security) e pode justificar
  elevar a severidade se houver requisito de compliance explícito na proposta.
- Cross-QA: cobertura de teste dos cenários de corrida (F-fault-tolerance-1, item positivo) também
  é insumo direto para `qa-testability` — os 7 cenários listados na seção 2 são um bom exemplo de
  "reprocess scenario coverage" a citar lá.
