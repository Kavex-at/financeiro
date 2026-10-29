---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-29-1628-sispag-confirmar-em-conjunto
agent: qa-fault-tolerance
generated_at: 2026-10-29T16:28:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista do SISPAG | POST `/sugestoes-boleto/confirmar-em-conjunto` com 30 títulos irmãos; servidor reinicia (deploy/OOM) depois do commit das decisões, antes/durante a fila de ajuste de centavos | `ConfirmacaoEmConjuntoService` → `BoletoSuggestionService.confirmar` → `AjusteCentavosTituloService.agendarEmSequencia` → `fin070` | Produção (modo efetivo `on`), carteira com 86 elegíveis, batch de 30 | Cada linha ou commita sozinha (`CONFIRMADA`/`JA_CONFIRMADA`) ou é recusada com motivo; ajustes de centavos pendentes são retomados por varredura; nenhuma renegociação dupla no `fin070` | 0 decisões duplicadas (unique index); 0 ajustes de centavos perdidos (todo pendente visível na varredura); replay do mesmo body = `JA_CONFIRMADA` em 100% das linhas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotência por linha (replay do mesmo body) | 30/30 `JA_CONFIRMADA` | 100% | ✅ | shared-metrics §Live measurement |
| Transação multi-write por linha | sim — `confirmar` roda `inserirDecisao` + `inserirEvento` dentro de `tx` | 100% | ✅ | `BoletoSuggestionService.ts:425,462,481` |
| Unique constraint anti-corrida | sim — par `(ddcCod,ditCod)` e `(filCod,docCod,titCod)` já expõe `JA_CONFIRMADA` | sim | ✅ | `BoletoSuggestionService.ts:427-447` |
| Independência por linha (nunca tudo-ou-nada) | sim — try/catch por linha, erro vira `RECUSADA` | sim | ✅ | `ConfirmacaoEmConjuntoService.ts:170-200` |
| Audit trail (quem, quando, o quê, `conjuntoId`) | sim — `DECISAO_CONFIRMADA` carrega `detalhe.conjunto.{id,tituloOrigem}` | 100% | ✅ | `BoletoSuggestionService.ts:1281-1287,478` |
| Limite de batch (bulk-head de carga) | 30 (`422` acima) | ≤30 | ✅ | `ConfirmacaoEmConjuntoService.ts:96-101`; shared-metrics (31 → 422) |
| Latência do batch (one scenario per batch) | 1.3 s / 30 linhas | ≤2 s | ✅ | shared-metrics |
| Idempotency-Key no POST (HTTP) | ausente | opcional (per-line idemp. supre) | ⚠️ | `src/backend/routes/sispag.ts:1023-1041` |
| Reaper de decisões `CONFIRMADA` sem ledger de ajuste | ausente — `retomarPendentes` só varre ledgers existentes | presente | ❌ | `AjusteCentavosTituloService.ts:247-276` |
| Timeout no cliente HTTP do FE para o POST | ausente — `fetch` sem `AbortController` para o conjunto | 60 s | ⚠️ | `src/frontend/lib/sispag.ts` (`confirmarEmConjunto`) |
| Botão "Confirmar" desabilitado enquanto salva | sim (`disabled={salvando}`) | sim | ✅ | `ConfirmacaoEmConjuntoSecao.tsx:424` |
| Reconciliação periódica contra Conexos (`fin070`) | ausente | presente | ⚠️ (fora do escopo do diff) | — |

> ⚠️ **Não medível localmente**: taxa real de restart do Node em produção (Render) e janela média de drenagem da fila `agendarEmSequencia`. Requer métricas Render/Datadog. Recomendação: instrumentar `agendarEmSequencia` com timer de drenagem e log na inicialização que correlaciona decisões `CONFIRMADA` sem ledger.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Zod no body (`ConfirmarEmConjuntoBodySchema`) + `BatchConfirmationTooLargeError` acima de 30 | ✅ | `ConfirmacaoEmConjuntoService.ts:95-101`, `routes/sispag.ts:1029` |
| Comparison | Credor da origem relido do título ao vivo e comparado com `pesCod` de cada linha; filial batida | ✅ | `ConfirmacaoEmConjuntoService.ts:103-109,165-169` |
| Timestamp | `decisao` grava `createdAt`; `DECISAO_CONFIRMADA` carrega `ator` + `conjuntoId` | ✅ | `BoletoSuggestionService.ts:465-482` |
| Timeout | Sem timeout explícito no `fetch` do FE para `confirmar-em-conjunto`; o `confirmar` individual já é limitado pelo tempo de transação do Postgres | ⚠️ parcial | `src/frontend/lib/sispag.ts` |
| Condition Monitoring | `retomarPendentes` varre ledgers não terminais na abertura da tela (`agendarVarredura`); NÃO cobre decisões sem ledger | ⚠️ parcial | `AjusteCentavosTituloService.ts:247-276,360` |
| Self-Test | — | N/A | serviço sem probe |
| Voting | — | N/A | só a decisão do servidor conta |
| Substitution / Replacement / Predictive Model / Increase Competence Set | — | N/A | fluxo não tem réplicas nem modelo preditivo |
| Redundancy | — | N/A | processo único (Render), banco único |
| Rollback (DB) | Transação por linha: erro em qualquer `insert` reverte a linha; outras linhas seguem | ✅ | `BoletoSuggestionService.ts` (`client.transaction`) |
| Idempotent Replay | Unique constraint + branch `JA_CONFIRMADA`; cliente pode retentar o mesmo body sem efeito duplicado | ✅ | shared-metrics (30/30 replay) |
| Compensating Transaction | Para o ajuste de centavos no `fin070`: sem compensação automática — o ledger tem write-ahead e o modo efetivo é a chave; forward recovery via retomada | ✅ (forward) | `AjusteCentavosTituloService.ts:125-128` (comentário I18h) |
| Reintroduction (Shadow / State Resync / Escalating Restart) | Modo `shadow` do ajuste de centavos existe (não escreve); `retomarPendentes` reintroduz pendentes | ✅ parcial | `AjusteCentavosTituloService.ts:252-275` |
| Quarantine | Linha com erro inesperado → `RECUSADA` com motivo genérico e log `BUSINESS_WARN`; não bloqueia o resto | ✅ | `ConfirmacaoEmConjuntoService.ts:188-200` |
| Reconcile | Ajuste de centavos reconcilia o `fin070` com o estado local via ledger; **não** há sweep que detecte decisão `CONFIRMADA` sem ledger de ajuste correspondente | ⚠️ parcial | — |
| Repair State | Via `anular` individual (fora do diff) ou retomada por filial no abrir da tela | ✅ parcial | `AjusteCentavosTituloService.ts:360-371` |

## 4. Findings (achados)

### F-fault-tolerance-1: Decisões `CONFIRMADA` do batch podem ficar órfãs do ajuste de centavos se o processo reiniciar entre o commit e o enfileiramento

- **Severidade**: P1
- **Tactic violada**: Condition Monitoring + Reconcile
- **Localização**: `src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts:121-128`; `src/backend/domain/service/sispag/AjusteCentavosTituloService.ts:247-276, 316-354`
- **Evidência (objetiva)**:
  ```
  // ConfirmacaoEmConjuntoService.ts:121-128
  for (const item of itens) {
      const r = await this.confirmarLinha(item, input.ator, conjunto, cenario);
      resultados.push(r.resultado);
      if (r.decisaoId) {
          pedidosAjuste.push({ ...this.soTitulo(item), decisaoId: r.decisaoId });
      }
  }
  this.ajusteCentavos.agendarEmSequencia(pedidosAjuste);  // fire-and-forget
  ```
  O ledger de ajuste é escrito dentro de `ajustar()` (write-ahead I18h). Se o Node reiniciar depois do commit da N-ésima decisão mas antes de `ajustar()` abrir a execução para o pedido N+1, nenhum ledger existe para N+1..M e `retomarPendentes` nunca os vê (ele itera `ledger.listarNaoTerminais`, não decisões `CONFIRMADA`).
- **Impacto técnico**: títulos permanecem `CONFIRMADA` no banco local sem o ajuste de centavos aplicado no `fin070` — a baixa pelo retorno banco diverge do valor negociado. A varredura `agendarVarredura` ao abrir a tela não corrige porque não existe entrada no ledger para retomar.
- **Impacto de negócio**: lote pode sair ao banco com valor divergente do boleto para múltiplos títulos simultaneamente; a divergência só aparece na conciliação do retorno. Em um batch de 30, metade tipicamente precisa de ajuste automático → janela de 10–20 títulos silenciosamente não ajustados por restart.
- **Métrica de baseline**: `# de decisões CONFIRMADA do conjunto sem ledger de ajuste correspondente após restart` — hoje não instrumentada; cenário reprodutível localmente derrubando o processo no meio do loop da linha 121. Shared-metrics: 30 linhas / batch, 1.3 s de janela de execução + N × ~2 s de drenagem assíncrona do ERP (janela típica 30–90 s em que o processo pode cair e perder os pedidos de ajuste).

### F-fault-tolerance-2: POST `confirmar-em-conjunto` sem `Idempotency-Key` no boundary HTTP

- **Severidade**: P2
- **Tactic violada**: Idempotent Replay (HTTP boundary)
- **Localização**: `src/backend/routes/sispag.ts:1023-1041`; `src/frontend/lib/sispag.ts` (`confirmarEmConjunto`)
- **Evidência**: a rota não lê nem persiste `Idempotency-Key`; a idempotência depende do unique index por linha (`ddcCod/ditCod` + `filCod/docCod/titCod`). Replay de HTTP com a mesma lista devolve `JA_CONFIRMADA` para todas as linhas confirmadas antes (medido: 30/30 `JA_CONFIRMADA`), mas o `conjuntoId` novo (UUID por chamada) gera dois `DECISAO_CONFIRMADA` com `detalhe.conjunto.id` diferentes no caso de replay com linhas realmente novas.
- **Impacto técnico**: no cenário de double-click ou retry do cliente (timeout de rede), o batch é reprocessado — correto por linha, mas um audit trail paralelo com dois `conjuntoId` diferentes cita a mesma ação do analista.
- **Impacto de negócio**: baixo (não há duplicação financeira); confunde a trilha de auditoria do SISPAG executar.
- **Métrica de baseline**: 0% dos POSTs de mutação financeira neste diff aceitam `Idempotency-Key`. Alvo: 100% para write financeiro.

### F-fault-tolerance-3: FE sem timeout no `fetch` do `confirmar-em-conjunto`; o usuário não sabe se o batch terminou

- **Severidade**: P2
- **Tactic violada**: Timeout
- **Localização**: `src/frontend/lib/sispag.ts` (`confirmarEmConjunto`); `src/frontend/app/sispag/components/ConfirmacaoEmConjuntoSecao.tsx:158-166`
- **Evidência**: `fetch(...)` chamado sem `AbortController` com deadline. O botão `salvando` protege contra double-submit no happy path, mas se o Render demorar 60 s ou o socket ficar pendurado, a UI trava no spinner sem feedback. O servidor roda 30 linhas em 1.3 s (shared-metrics), portanto o timeout razoável é curto.
- **Impacto técnico**: usuário recarrega a página, reabrir a gaveta mostra as linhas já confirmadas (release correto), mas a UX é degradada; abrir novo POST do zero devolve `JA_CONFIRMADA` nas linhas commitadas (ok).
- **Impacto de negócio**: percepção de instabilidade; o analista pode decidir não usar o fluxo em batch.
- **Métrica de baseline**: 0 timeouts no `fetch`; alvo: 60 s com retry manual explícito.

### F-fault-tolerance-4: Ausência de reconciliação cross-cutting entre decisões SISPAG e `fin070`

- **Severidade**: P2
- **Tactic violada**: Reconcile
- **Localização**: cross-cutting; não há job periódico que lê decisões `CONFIRMADA` do dia e confere no `fin070` que o ajuste e o item do borderô refletem o valor confirmado.
- **Evidência**: `grep -rn "reconcili\|audit.*fin070" src/backend` — sem job diário comparando o estado local com o `fin070` para o universo de decisões em conjunto.
- **Impacto técnico**: dependência do ledger de ajuste como única fonte de verdade; qualquer caminho que não passe por ele (F-fault-tolerance-1) fica invisível.
- **Impacto de negócio**: divergências silenciosas sobre valores de títulos SISPAG.
- **Métrica de baseline**: 0 jobs de reconciliação deste tipo; alvo: 1 job diário cobrindo a janela D-1.

## 5. Cards Kanban

### [fault-tolerance-1] Varrer decisões `CONFIRMADA` sem ledger de ajuste e enfileirar o ajuste faltante

- **Problema**
  > Em um batch de confirmação em conjunto, `agendarEmSequencia` é fire-and-forget após o loop. Se o processo reiniciar entre o commit da decisão N e a entrada no ledger de ajuste N+1, as decisões N+1..M ficam `CONFIRMADA` sem nenhum rastro para `retomarPendentes`. Em batches de 30 (medido), a janela de perda é da ordem de 30–90 s por POST.

- **Melhoria Proposta**
  > Dois caminhos complementares (Condition Monitoring + Reconcile):
  > 1. Em `ConfirmacaoEmConjuntoService.confirmarLinha`, após o commit da decisão, abrir sincronamente a entrada do ledger (`ledger.abrir`) no estado `pendente` com `gatilho=CONJUNTO`, ANTES de responder. O `agendarEmSequencia` passa a só executar; não precisa criar entrada.
  > 2. Alternativamente/adicionalmente, estender `agendarVarredura` para também listar `DecisaoSugestao` com `decisao=CONFIRMADA` recentes que não tenham ledger associado (hoje a varredura só olha `ledger.listarNaoTerminais`).

- **Resultado Esperado**
  > `# decisões CONFIRMADA sem ledger após restart artificial`: desconhecido → 0 em teste de caos; `% ajustes de centavos aplicados por batch`: ≥99% dentro de 10 min de drenagem.

- **Tactic alvo**: Condition Monitoring, Reconcile
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-4
- **Métricas de sucesso**:
  - decisões `CONFIRMADA` órfãs após restart: desconhecido → 0
  - cobertura de retomada pela varredura ao abrir a tela: só-ledger → ledger + decisões recentes
- **Risco de não fazer**: divergências silenciosas de centavos no `fin070` em batches durante janelas de deploy; a divergência só aparece na conciliação do retorno, dias depois.
- **Dependências**: nenhuma

### [fault-tolerance-2] Aceitar `Idempotency-Key` no POST `confirmar-em-conjunto`

- **Problema**
  > A rota não aceita `Idempotency-Key`. Replay por timeout de rede refaz o batch com novo `conjuntoId` (UUID), gerando trilha de auditoria com dois `conjunto.id` para a mesma ação do analista. A idempotência por linha protege o estado financeiro, mas não o audit trail.

- **Melhoria Proposta**
  > Ler `Idempotency-Key` do header, persistir a tupla `(key, ator, hash do body)` → `conjuntoId` por 24 h. Hit = replay devolve o `ResultadoConjunto` original, não reexecuta. Tocar `src/backend/routes/sispag.ts:1023-1041` e um `IdempotencyRepository` genérico.

- **Resultado Esperado**
  > Replay de HTTP preserva `conjuntoId`; audit trail de dois eventos `DECISAO_CONFIRMADA` com mesmo `conjunto.id` → 1 evento no caminho feliz, 0 duplicatas no replay.

- **Tactic alvo**: Idempotent Replay
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - % POSTs de mutação financeira SISPAG com `Idempotency-Key` aceita: 0% → 100%
- **Risco de não fazer**: trilhas de auditoria com múltiplos `conjuntoId` por decisão em cenários de retry; dificulta forense.
- **Dependências**: nenhuma

### [fault-tolerance-3] Adicionar timeout e feedback no `fetch` do `confirmar-em-conjunto`

- **Problema**
  > `confirmarEmConjunto` em `src/frontend/lib/sispag.ts` chama `fetch` sem `AbortController`. Com o batch rodando em 1.3 s em condições normais, uma rede lenta deixa a UI pendurada sem motivo.

- **Melhoria Proposta**
  > Envolver com `AbortController` + `signal`; deadline 60 s. Em `ConfirmacaoEmConjuntoSecao.tsx`, no `catch` do `enviar`, diferenciar `AbortError` de erro de servidor na mensagem.

- **Resultado Esperado**
  > Timeout no `fetch`: ausente → 60 s. UX recebe mensagem acionável em 100% dos POSTs > 60 s.

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - % mutações financeiras do FE com timeout: 0 → 100 (neste fluxo)
- **Risco de não fazer**: analista recarrega a tela sem feedback; retrabalho de verificação manual.
- **Dependências**: nenhuma

### [fault-tolerance-4] Job diário de reconciliação SISPAG × `fin070`

- **Problema**
  > Não há sweep diário que confirme que as decisões `CONFIRMADA` do dia correspondem a títulos ajustados no `fin070`. Divergências aparecem só na conciliação do retorno (dias depois).

- **Melhoria Proposta**
  > Criar job (quando a infra alvo existir; hoje `src/backend/jobs/`) que, para a janela D-1, cruza `decisao_sugestao_boleto` com o estado do ledger e com uma leitura do `fin070` em modo shadow (sem escrita), gerando log de divergência consumido pelo painel-operacao.

- **Resultado Esperado**
  > Taxa de divergência SISPAG × `fin070` detectada em D-1: desconhecida → medida; MTTR de divergência: dias → horas.

- **Tactic alvo**: Reconcile
- **Severidade**: P2
- **Esforço estimado**: L
- **Findings relacionados**: F-fault-tolerance-4, F-fault-tolerance-1
- **Métricas de sucesso**:
  - job presente: não → sim
  - divergências de valor detectadas em D-1: desconhecido → métrica diária
- **Risco de não fazer**: divergências silenciosas acumuladas; a conciliação de retorno vira o único detector, com atraso.
- **Dependências**: card fault-tolerance-1 (preencher o ledger primeiro)

## 6. Notas do agente

- Escopo restrito ao diff: `ConfirmacaoEmConjuntoService` + `agendarEmSequencia` + rota + FE. O ajuste de centavos pré-existente (ADR-0074) não foi reauditado além da interação com o batch.
- F-1 é o único achado P1 e tem baseline numérica (shared-metrics §Live: 30 linhas, 1.3 s de execução + janela de drenagem assíncrona). Reproduzível com `kill -9` do servidor entre linhas do loop.
- Cross-QA: Idempotency-Key e timeout no FE conversam com `qa-availability` e `qa-performance`; o audit trail do `conjuntoId` conversa com `qa-security` (auditabilidade); a cobertura de testes para o cenário de restart mid-queue conversa com `qa-testability` (hoje `ConfirmacaoEmConjuntoService.test.ts` cobre replay e recusas, não restart).
- "Reconcile contra Conexos" (card 4) é débito arquitetural pré-existente, mencionado por completude; o diff não piora o estado.
