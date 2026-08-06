---
qa: Performance
qa_slug: performance
run_id: 2026-08-06-1945
agent: qa-performance
generated_at: 2026-08-06T19:45:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Aprovar" no painel de borderôs | 1 chamada HTTP ao backend (`finalizarBordero`) | `BorderoGestaoService.finalizarBordero` (com `assertBorderoTemItens` novo) + `ConexosBaixaClient.listBaixas` + `finalizarBordero` | Regime normal (Express + Conexos on-prem sobre HTTP) | Aprova o borderô OU rejeita ANTES do POST quando não há item no ERP | Latência p95 do clique "Aprovar" (Conexos RTT × 2 ao invés de × 1). Baseline numérico **não medível** neste worktree (ver seção 2). |
| Analista processa um adiantamento cuja baixa falha em TODAS as invoices | 1 chamada `reconciliar` | `ReconciliacaoPermutaService.removerBorderoOrfao` (novo) | Caminho de exceção (nenhuma baixa `settled`) | Remove o casco no ERP + cache; se falhar, vira `BUSINESS_WARN` (não derruba o erro real) | +2 RTT ao Conexos SOMENTE no caminho de falha total. Zero custo no caminho feliz. |
| Usuário abre `/permutas/borderos` | Render da tabela (50 itens/página; até 500 carregados) | `BorderosPanel.tsx` avalia `b.baixas.some(x => x.status === 'settled')` por linha | Regime normal (browser render) | Botão "Aprovar" habilita/desabilita | O(50 × baixasPorBorderô) por render — ordem de nanosegundos em JS moderno. |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| RTT extra ao Conexos por aprovação de borderô (chamadas ao ERP: **1 → 2**) | +1 `listBaixas` obrigatório antes do `finalizarBordero` | ≤ +1 RTT aceitável se justificado por UX/correção | ⚠️ | `BorderoGestaoService.ts:205` (`await this.assertBorderoTemItens(...)`) |
| Latência típica de `listBaixas` (`POST /fin010/baixas/list/{borCod}`) | **Não medível**: sem log/HAR com tempos no repo — nenhuma evidência histórica do tipo `→ 200 (Xms)` encontrada em `ontology/` ou `docs/`. `grep -rn "→ 200\|responseTime\|latency" ontology/ docs/` → 0 hits relevantes. | Precisa ser instrumentado (métrica `conexos.listBaixas.duration_ms` p50/p95) | ❌ | `grep -rn "→ 200\|responseTime\|latency" ontology/ docs/` |
| RTT extra ao Conexos quando TODAS as baixas falham (caminho de exceção) | +2 (`listBaixas` + `excluirBordero`) | 0 no caminho feliz; N/A no caminho de falha (troca higiene por RTT) | ✅ (só na exceção) | `ReconciliacaoPermutaService.ts:291-293, 310-344` |
| RTT extra ao Conexos no caminho FELIZ da reconciliação (ao menos uma baixa `settled`) | 0 | 0 | ✅ | `ReconciliacaoPermutaService.ts:291` — gate `!resultados.some(isBaixaConfirmada)` |
| Custo do `.some()` por linha no `BorderosPanel` | O(50 × avg_baixas_por_borderô) por render. Cap superior conhecido: 500 borderôs carregados (limit em `BorderoGestaoService.listarBorderos`), 50 renderizados por página. `baixas` por borderô é tipicamente 1–N pequeno (baixas de permuta 1:1 dominam). | O(1k) iterações em JS = nanosegundos por render → alvo alcançado | ✅ | `BorderosPanel.tsx:471`; limite em `BorderoGestaoService.ts:322`; page size 50 em `BorderosPanel.tsx:197` |
| Nº de chamadas ao Conexos por aprovação (antes → depois) | 1 → 2 (`listBaixas` + `finalizarBordero`) | 1 (ou 2, com trade-off documentado) | ⚠️ | Comparação `BorderoGestaoService.ts:200-217` vs. baseline pré-delta |
| Volume esperado de aprovações/dia | **Não medível**: sem métrica histórica; borderô 18538 (a origem do bug) foi um caso isolado. Em geral analistas aprovam borderôs em lotes ao final do dia. | Precisa telemetria (`finalize_bordero.count`) | ❌ | Ausência de logs |

## 3. Tactics — Cobertura no delta

Escopo restrito: apenas as tactics tocadas pelo delta. Para as demais, ver o cenário geral da rodada.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Bound Execution Times | `assertBorderoTemItens` interrompe a aprovação **antes** do POST irreversível quando o ERP não tem item — evita um POST fadado a erro; substitui um caminho ERP RTT (rejeição pós-POST) por outro (rejeição pré-POST). NÃO reduz o RTT total no caminho feliz (adiciona 1). | ⚠️ parcial | `BorderoGestaoService.ts:264-272` |
| Limit Event Response | Frontend desabilita "Aprovar" quando `!b.baixas.some(x => x.status === 'settled')` → impede o próprio disparo do POST quando a trilha já sabe que não há baixa confirmada. Reduz o número de aprovações que vão gastar o `listBaixas` extra (o servidor ainda valida — defesa em profundidade). | ✅ presente | `BorderosPanel.tsx:471, 477` |
| Reduce Overhead | **Ausente na aprovação**. `assertBorderoTemItens` sempre bate no ERP; poderia curto-circuitar quando a trilha já mostra `≥ 1` baixa `settled` (ver Card `performance-1`). No caminho feliz da reconciliação, `removerBorderoOrfao` é evitado com `!resultados.some(isBaixaConfirmada)` — bom exemplo local desta tactic. | ⚠️ parcial | `ReconciliacaoPermutaService.ts:291` (bom) vs. `BorderoGestaoService.ts:205` (oportunidade) |
| Manage Sampling Rate | Não aplicado ao `listBaixas` de aprovação — cada aprovação re-consulta. Volume esperado (aprovações/dia) baixo → tactic de baixa prioridade. | ❌ ausente (por escolha, custo/benefício negativo agora) | `BorderoGestaoService.ts:205` |
| Increase Resource Efficiency | `removerBorderoOrfao` só roda quando estritamente necessário (`borderoCriadoAqui && !resultados.some(isBaixaConfirmada)`) — zero custo no caminho feliz. Frontend `.some()` é O(pequeno×pequeno), sem necessidade de `useMemo`. | ✅ presente | `ReconciliacaoPermutaService.ts:291`; `BorderosPanel.tsx:434-471` |
| Prioritize Events | N/A — não há filas ou eventos concorrentes tocados pelo delta. | N/A | — |
| Increase Concurrency | N/A — chamadas sequenciais dentro de um caminho single-tenant do analista. | N/A | — |
| Bound Queue Sizes | N/A — não há filas tocadas pelo delta. | N/A | — |

## 4. Findings

### F-performance-1: `finalizarBordero` paga +1 RTT ao Conexos por aprovação (`listBaixas`) com baseline de latência não medível no repo

- **Severidade**: P2 (rebaixada de P1 por falta de baseline numérico — regra da rodada)
- **Tactic violada**: Reduce Overhead (parcial); Manage Sampling Rate (ausente por escolha)
- **Localização**: `src/backend/domain/service/permutas/BorderoGestaoService.ts:200-217` (`finalizarBordero`) e `:264-272` (`assertBorderoTemItens`)
- **Evidência (objetiva)**:
  ```
  public finalizarBordero = async (params: { borCod, executadoPor }) => {
      const filCod = await this.guardAcaoBordero(params.borCod);
      await this.assertBorderoTemItens(filCod, params.borCod); // +1 listBaixas ao ERP
      await this.conexosBaixaClient.finalizarBordero({ filCod, borCod: params.borCod });
      ...
  };
  private assertBorderoTemItens = async (filCod, borCod) => {
      const baixas = await this.conexosBaixaClient.listBaixas({ filCod, borCod });
      if (baixas.length === 0) throw new Error('Borderô ... não possui baixas ...');
  };
  ```
- **Impacto técnico**: Toda aprovação passa a fazer **2 chamadas** ao Conexos em vez de 1 (`listBaixas` + `finalizarBordero`). No caminho feliz (borderô com itens — que é a esmagadora maioria — como as próprias regras do painel já garantem via `.some(settled)` do UI), o `listBaixas` é 100% overhead: o ERP aceitaria o `finalizarBordero` normalmente. O trade-off é justificado pela regra I-Write-7: a trilha guarda linhas `error` com `bor_cod` mas sem baixa, então **não pode** ser usada como fonte da verdade sem falso-positivo (borderô 18538 confirmou isso em produção).
- **Impacto de negócio**: Latência percebida do clique "Aprovar" cresce ~1 RTT do Conexos. O Conexos é on-prem em rede corporativa — sem baseline no repo, mas conhecidamente da ordem de centenas de ms a segundos (o próprio prompt cita "2–10s p99" como plausível para chamadas ao ERP em cenários piores). No pior caso pessimista (2s p95), isso dobra o tempo de aprovação (2s → 4s). No caso benigno (200 ms p95) o custo é imperceptível. Volume esperado de aprovações/dia é baixo (analistas em lote no final do dia) → impacto agregado limitado, mas cada clique individual custa mais.
- **Métrica de baseline**: **Não medível** — repo não tem HAR/log com tempos de `listBaixas` (`fin010/baixas/list`). `grep -rn "→ 200\|responseTime\|latency" ontology/ docs/` → 0 hits relevantes. Recomendação: instrumentar `conexos.<endpoint>.duration_ms` (histogram) — fica no card `performance-2`.

### F-performance-2: Latência das chamadas ao Conexos não é instrumentada — impossível provar/negar impacto do delta em produção

- **Severidade**: P2 (a ausência de baseline é o gargalo antes de qualquer otimização — regra da rodada)
- **Tactic violada**: (meta-tactic) — **Measure Performance** (Bass fala em observabilidade como pré-condição para todas as tactics)
- **Localização**: `src/backend/domain/client/ConexosBaseClient.ts` (nenhum `duration_ms` capturado); `src/backend/domain/client/ConexosBaixaClient.ts:140-190` (`listBaixas`)
- **Evidência (objetiva)**:
  ```
  $ grep -n "duration\|elapsed\|Date.now\|performance\.now\|latency" \
        src/backend/domain/client/ConexosBaseClient.ts
  # (sem hits relevantes — só comentários sobre timestamps de calendário)
  ```
- **Impacto técnico**: Nenhuma decisão de otimização subsequente é falseável. Não dá para dizer se o `+1 RTT` do F-performance-1 é 50 ms ou 3 s. P0/P1 exigem baseline numérico — sem telemetria, todo finding de latência do Conexos fica rebaixado.
- **Impacto de negócio**: Regressões de latência só serão descobertas por reclamação do analista, não por SLI/alerta. Cada frente que integra ao Conexos (Permutas, SISPAG, Recebimentos) partilha o mesmo cego.
- **Métrica de baseline**: 0 métricas de tempo por endpoint hoje. Alvo: p50/p95 por endpoint (Prometheus-ish counter + histogram), começando por `fin010/baixas/list` e `fin010/finalizar` — os dois usados no caminho de aprovação.

### F-performance-3: `removerBorderoOrfao` custa 0 RTT no caminho feliz e ~2 RTT SÓ na falha total — bem escopado

- **Severidade**: P3 (informacional — nenhum ajuste de código necessário)
- **Tactic violada**: nenhuma (é a implementação positiva de **Increase Resource Efficiency**)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:286-293` (gate) e `:310-344` (execução)
- **Evidência (objetiva)**:
  ```
  // I-Write-7 (anti-órfão): ... roda no FIM do loop, não na 1ª falha ...
  if (borderoCriadoAqui && borCod !== undefined && !resultados.some(isBaixaConfirmada)) {
      await this.removerBorderoOrfao({ filCod, borCod, adiantamentoDocCod });
  }
  ```
  ```
  const isBaixaConfirmada = (r: ResultadoAlocacao): boolean => r.status === 'settled';
  ```
  O gate exige:
  1. `borderoCriadoAqui` — borderô criado NESTA chamada (não age em borderô pré-existente).
  2. `borCod !== undefined` — o `criarBordero` completou.
  3. `!resultados.some(isBaixaConfirmada)` — nenhuma baixa terminou `settled` (caminho de exceção).
  Caminho feliz típico (ao menos 1 `settled`) → 0 chamada extra ao Conexos.
- **Impacto técnico**: Sem sobrecusto no caminho feliz. No caminho de exceção paga 2 RTT (`listBaixas` + `excluirBordero`) para higiene — trade-off aceitável, ainda mais porque o erro real da baixa já foi capturado (`markError` + log) e o casco vazio bloquearia a próxima operação do analista.
- **Impacto de negócio**: Positivo — casco vazio não aparece no painel de aprovação; um problema documentado em produção (borderô 18538) fica resolvido sem custo no caminho comum.
- **Métrica de baseline**: N/A — este finding é para **confirmar** que o custo do delta é bem escopado, não para atacar um problema.

## 5. Cards Kanban

### [performance-1] Curto-circuitar `assertBorderoTemItens` quando a trilha já garante ≥ 1 baixa `settled`

- **Problema**
  > Toda aprovação passa a fazer +1 chamada ao Conexos (`listBaixas`) antes do `finalizarBordero`, mesmo quando a trilha local (`permuta_alocacao_execucao`) já mostra ≥ 1 linha `status='settled'` para aquele borderô — cenário que representa o caminho feliz da esmagadora maioria das aprovações (borderôs que subiram pelo próprio painel). O motivo da consulta ao ERP (regra I-Write-7) é evitar contar linhas `error` com `bor_cod` como "item"; mas `error` NUNCA é `settled`, então basta contar `settled` na trilha. Sem baseline de latência (F-performance-2), não dá para quantificar, mas cada aprovação hoje dobra o número de RTTs ao Conexos vs. o baseline pré-delta (1 → 2).

- **Melhoria Proposta**
  > No `assertBorderoTemItens`, ler primeiro a trilha via `execucaoRepository.listByBorCod(borCod)` (já usada pelo `requireOwnBorderoFilCod`, portanto o cache do request já cobre) e curto-circuitar quando `rows.some(r => r.status === 'settled')` — aí NÃO chama o ERP. Só cai no `listBaixas` quando a trilha só tem `error`/`reconciling` (o cenário exato de I-Write-7). Mantém a mesma correção (linha `error` não é contada), pega o caminho feliz. Tactic: **Reduce Overhead** + **Manage Sampling Rate** (amostra o ERP só quando a fonte local é ambígua). Arquivo único a tocar: `src/backend/domain/service/permutas/BorderoGestaoService.ts:264-272`. O front (`BorderosPanel.tsx:471`) já usa a mesma heurística de `settled` para desabilitar o botão, então a semântica UI/API bate.

- **Resultado Esperado**
  > Chamadas ao Conexos por aprovação no caminho feliz: **2 → 1** (elimina o `listBaixas` extra na maioria absoluta). Caminho de casco vazio: comportamento inalterado (recusa antes do POST com mensagem acionável). Testes existentes em `BorderoGestaoService.test.ts` continuam verdes; adicionar um caso "trilha tem `settled` → não chama `listBaixas`".

- **Tactic alvo**: Reduce Overhead (Bass — Control Resource Demand)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Nº de `listBaixas` disparados por aprovação (caminho feliz): 1 → 0
  - Nº total de RTTs ao Conexos por aprovação (caminho feliz): 2 → 1
  - `assertBorderoTemItens` p50 no caminho feliz: 1× RTT Conexos → ~1 ms (query local)
- **Risco de não fazer**: Cada nova UX que atravesse este método herda o RTT extra; sem instrumentação (F-performance-2), o overhead fica invisível até virar reclamação de "aprovar ficou lento".
- **Dependências**: nenhuma bloqueante; ideal fazer depois (ou junto com) `performance-2`, senão não dá para medir o ganho.

### [performance-2] Instrumentar latência das chamadas ao Conexos (`ConexosBaseClient`)

- **Problema**
  > Nenhuma chamada ao ERP é medida hoje (`grep` por `duration/elapsed/Date.now/performance.now/latency` no `ConexosBaseClient.ts` → 0 hits). Este delta introduziu +1 RTT por aprovação (F-performance-1), mas o repo não tem baseline — impossível classificar o impacto real (P1 vs P3) e impossível provar o ganho do card `performance-1`. Vale para as três frentes (Permutas, SISPAG, Recebimentos).

- **Melhoria Proposta**
  > No wrapper de chamadas em `ConexosBaseClient` (onde já vive `runWithRetry`), envelopar cada request num timer (`performance.now()` antes/depois) e logar `{ endpoint, method, duration_ms, status, attempts }` via `LogService`. Como o backend hoje é Express (sem CloudWatch), começar por log estruturado — depois virar histograma quando a rodada de infra chegar. Endpoints-alvo prioritários: `fin010/baixas/list`, `fin010/finalizar/{borCod}`, `fin010/{filCod}/{borCod}` (`getBordero`), `fin010/list` (`listBorderos`). Tactic: **Measure Performance** (pré-condição de qualquer outra tactic).

- **Resultado Esperado**
  > p50/p95 por endpoint disponível em log em ≤ 1 semana de uso em produção. Baseline conhecido para `listBaixas` (usado pelo delta) e `finalizarBordero`. Regressões futuras (~+50 % de p95) viram alertáveis. Card `performance-1` fica falseável (medir ganho real do curto-circuito).

- **Tactic alvo**: (meta) Measure Performance — pré-condição para todas as tactics de Manage Resources/Control Resource Demand
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Cobertura de instrumentação por endpoint Conexos: 0 % → 100 % (nos endpoints do painel de borderô)
  - Baseline de p95 `listBaixas` documentado: ausente → registrado em `ontology/_inbox/` ou dashboard
- **Risco de não fazer**: Todo card futuro de performance no eixo Conexos fica com severidade rebaixada por falta de baseline. Regressões só são pegas por analista reclamando.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo**: revisei APENAS o delta (`removerBorderoOrfao`, `assertBorderoTemItens`, `.some()` no `BorderosPanel`), como pedido. Não abri findings sobre bundle, pool, N+1 fora do delta — reservados para uma rodada full.
- **P0/P1 → P2**: sigo a regra da rodada — sem baseline numérico, sem P1. F-performance-1 seria P1 num contexto onde a latência de `listBaixas` fosse conhecida (ex.: > 1 s p95); rebaixei explicitamente.
- **`removerBorderoOrfao` é bem escopado** — só na exceção; e o caminho feliz da reconciliação NÃO paga custo nenhum (confirmado no gate `!resultados.some(isBaixaConfirmada)`). Nenhum card gerado a partir de F-performance-3 (é elogio, não achado).
- **Frontend `.some()` por linha**: com cap de 500 borderôs carregados e 50 renderizados/página, o custo é nanosegundos — nenhum card, nenhuma otimização recomendada (`useMemo` seria over-engineering aqui).
- **Cross-QA**: F-performance-1 conversa com **Fault-Tolerance** (I-Write-7 é o motivo do custo extra) e **Integrability** (o custo é acoplamento ao Conexos como fonte-da-verdade). F-performance-2 conversa com **Availability** e **Testability** (observabilidade). Consolidator: pode marcar F-performance-1 como "custo aceito pela FT".
