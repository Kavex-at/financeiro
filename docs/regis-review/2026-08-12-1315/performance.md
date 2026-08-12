---
qa: Performance
qa_slug: performance
run_id: 2026-08-12-1315
agent: qa-performance
generated_at: 2026-08-12T13:15:00-03:00
scope: backend
score: 7
findings_count: 4
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Processar" na carteira de recebimentos | `POST /transacoes/:txnId/solicitacao-numerario` (síncrono, com o analista esperando a resposta) | `RecebimentoNumerarioService.processarAlocacao` + a nova `etapaDescricaoItem` que agora roda antes de `etapaFiscal` | Produção (Render/Express + Conexos ERP p50 ~300-500 ms/call, p99 2-10 s) | Concluir SN+fin014+NDe+fiscal+obs+homologa antes do timeout de 40 s por chamada; adicionar a menor sobrecarga possível para garantir `dprLngDescrNf` não-vazia | Caso comum (`dprLngDescrNf` já vem preenchida): +1 round-trip Conexos (POST `com297/comDocProdutos/list`, pageSize 200) sobre um caminho que já executa ~20-30 chamadas — overhead marginal ≤ 5% na latência total; caso raro (campo vazio): +3 round-trips (GET `preDescrProdutoNf` + GET item + PUT item) — overhead ~10-15% |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas Conexos adicionadas ao caminho síncrono no CASO COMUM (descrição preenchida) | +1 (POST `com297/comDocProdutos/list`) | ≤ 1 | ✅ | `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1458-1477` |
| Chamadas adicionadas no CASO EMPTY (`dprLngDescrNf` vazia) | +3 por item (GET preDescr + GET item + PUT) | ≤ 3 (aceitável — é o mínimo pra RMW) | ✅ | `RecebimentoNumerarioService.ts:1478-1490` |
| Latência marginal p50 esperada no caso comum (Conexos ~300 ms/call) | ~300-500 ms adicionados a um baseline de ~6-10 s | ≤ 1 s adicionais | ✅ | inferência: baseline `processarAlocacao` faz ~20-30 chamadas Conexos (grep `gerDocClient\.|fiscalClient\.|fin014Client\.|ndeClient\.` em `RecebimentoNumerarioService.ts` = 38 sites) |
| Latência marginal p50 esperada no caso empty | ~1-1.5 s adicionados | ≤ 2 s adicionais | ✅ | 3 × 300-500 ms |
| Latência marginal p99 no caso comum (Conexos ~2-10 s p99 + retry `runWithRetry` de 2 tentativas × 500 ms de delay) | até ~10-20 s se o `com297/list` degradar | ≤ 10 s (aceitável dado o `timeout: 40000` do axios base) | ⚠️ | `src/backend/domain/client/ConexosBaseClient.ts:154-163`; `src/backend/services/conexos.ts:121` (`timeout: 40000`) |
| Iterações do loop `for (item of itens)` | 1 na prática (NDe da SN-Encomenda emite 1 item) | ≤ N reais; sem paginação silenciosa | ⚠️ | `RecebimentoNumerarioService.ts:1476`; `ConexosNdeFiscalClient.ts:273` (`pageSize: 200` fixo, sem loop de paginação) |
| N+1 real no caso comum (`dprLngDescrNf` preenchida) | 0 (curto-circuito por `continue`) | 0 | ✅ | `RecebimentoNumerarioService.ts:1477` |
| N+1 potencial no caso empty (3 chamadas por item, sequenciais) | 3×N sequenciais; N=1 hoje, sem paralelismo | Não é problema em N=1; será se N crescer | ⚠️ | `RecebimentoNumerarioService.ts:1476-1490` (`for..of await`, não `Promise.all`) |
| Cost de fallback env `NDE_DESCRICAO_ITEM_FALLBACK` (short-circuit sem GET `preDescrProdutoNf`) | 2 chamadas em vez de 3 no caso empty | preserva RMW mínimo | ✅ | `RecebimentoNumerarioService.ts:1524-1526` (curto-circuita `preDescr` quando env setada) |
| Retries do `preDescrProdutoNf` (best-effort) | 0 (single attempt, engole erro) | 0 (correto — é enfeite) | ✅ | `ConexosNdeFiscalClient.ts:340-348` (sem `runWithRetry`, `catch { return undefined }`) |
| Retries do `listItensNde` e `lerItemNde` | 2 tentativas (`runWithRetry`) | 2 (padrão do stack) | ✅ | `ConexosNdeFiscalClient.ts:265, 312` |
| Retries do `gravarDescricaoItemNde` (PUT) | 0 (`putGenericOnce`) | 0 (correto para escrita) | ✅ | `ConexosNdeFiscalClient.ts:399` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — endpoint disparado pelo analista, sem sampling. | N/A | rota `POST /transacoes/:txnId/solicitacao-numerario` |
| Limit Event Response | `heavyRouteLimiter` (rate limit) na rota | ✅ | `src/backend/routes/recebimentos.ts:452` |
| Prioritize Events | N/A — request/response único; não há fila. | N/A | — |
| Reduce Overhead | Caso comum curto-circuita no `continue` (linha 1477): item já tem descrição → nenhuma leitura/escrita extra | ✅ | `RecebimentoNumerarioService.ts:1477` |
| Bound Execution Times | axios `timeout: 40000` por chamada; `RetryExecutor` limita a 2 tentativas | ✅ | `src/backend/services/conexos.ts:121`; `ConexosBaseClient.ts:154-163` |
| Increase Resource Efficiency | `preDescrProdutoNf` sem retry (best-effort correto); `putGenericOnce` para o PUT (sem custo de retry) | ✅ | `ConexosNdeFiscalClient.ts:340, 399` |
| Increase Resources | N/A — infra Render fixa. | N/A | — |
| Increase Concurrency | Loop é sequencial (`for..of await`), NÃO `Promise.all`. Em N=1 é irrelevante; em N>1 seria oportunidade. | ⚠️ parcial | `RecebimentoNumerarioService.ts:1476-1490` |
| Maintain Multiple Copies of Computations | N/A — cálculo determinístico por item, sem cache útil. | N/A | — |
| Maintain Multiple Copies of Data | N/A — leitura sempre do ERP (RMW; cache seria incorreto). | N/A | — |
| Bound Queue Sizes | N/A — sem fila neste delta. | N/A | — |
| Schedule Resources | N/A — sincronismo com o analista. | N/A | — |
| Cold start budget | Delta não muda o bundle (nenhum import novo pesado; só um método a mais em cliente já injetado) | ✅ | `ConexosNdeFiscalClient.ts` adiciona 4 métodos ao cliente `@singleton` já existente |
| Cache strategy | `env.ndeDescricaoItemFallback` (env cache implícito no `EnvironmentProvider`) permite pular o GET `preDescrProdutoNf` sem HTTP quando o fiscal fixou o texto | ✅ | `RecebimentoNumerarioService.ts:1524-1526`; `EnvironmentProvider.ts:178` |
| Index discipline | N/A — sem SQL novo no delta. | N/A | — |
| Bundle leanness | Sem novas dependências. | ✅ | `git diff main -- src/backend/package.json` vazio |

## 4. Findings (achados)

### F-performance-1: pageSize 200 fixo em `listItensNde`, sem loop de paginação — truncamento silencioso quando > 200 itens

- **Severidade**: P3 (baixo — a NDe atual do fluxo emite 1 item; ~200x de folga)
- **Tactic violada**: Bound Execution Times / Limit Event Response (o limite existe, mas não é observável quando exercido)
- **Localização**: `src/backend/domain/client/ConexosNdeFiscalClient.ts:272-274`
- **Evidência (objetiva)**:
  ```typescript
  {
      fieldList: [],
      filterList: {},
      pageNumber: 1,
      pageSize: 200,
      orderList: { orderList: [{ propertyName: 'dprCodSeq', order: 'asc' }] },
  },
  ```
- **Impacto técnico**: se o ERP alguma vez materializar uma NDe com > 200 linhas de produto (mudança no cadastro/config do cliente), as linhas 201..N ficam invisíveis para a etapa de conserto de descrição. O ERP homologa (ou reprova) sem que a automação tenha tentado corrigir o resto.
- **Impacto de negócio**: assimetria oculta entre "achamos que consertamos a nota" e "consertamos parcialmente". Auditoria não distingue.
- **Métrica de baseline**: `pageSize: 200`, N observado hoje = 1, folga ~200×; sem alarme/warn quando `rows.length === pageSize`.

### F-performance-2: loop `for..of await` sequencial (N+1 estrutural) quando `N > 1` no caso empty

- **Severidade**: P3 (baixo — N=1 na prática; overhead teórico ~1-1.5 s × N no caso empty)
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1476-1506`
- **Evidência (objetiva)**:
  ```typescript
  for (const item of itens) {
      if (item.dprLngDescrNf !== undefined) continue;
      const descricao = await this.resolverDescricaoItem(ctx, item); // 1 GET
      const completo = await this.fiscalClient.lerItemNde({ ... });   // 1 GET
      const eco = await this.fiscalClient.gravarDescricaoItemNde({ ... }); // 1 PUT
  }
  ```
- **Impacto técnico**: para cada item com descrição vazia, 3 chamadas sequenciais ao Conexos. Se N cresce (ex.: mudança do cadastro do produto na Columbia), latência escala linear (≈ 3 × 300-500 ms × N no p50; 3 × 2-10 s × N no p99). O timeout de 40 s por chamada não segura o timeout HTTP do request agregado.
- **Impacto de negócio**: analista fica travado na tela por dezenas de segundos se um cliente novo produzir NDe multi-item vazia.
- **Métrica de baseline**: N=1 hoje; latência marginal ~1-1.5 s (p50). Sem teste de carga com N>1.

### F-performance-3: escolha arquitetural — pagar 1 round-trip SEMPRE vs. só consertar quando homologação falhar

- **Severidade**: P3 (baixo — decisão consciente, com racional documentado; anotado para o consolidator ver o trade-off)
- **Tactic violada**: nenhuma (é um trade-off entre Reduce Overhead do caso comum vs. simplicidade/fail-closed antes do irreversível)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1447-1450` (docstring) + `1455-1462` (chamada sempre)
- **Evidência (objetiva)**:
  ```typescript
  // etapaDescricaoItem — chamada SEMPRE, antes de etapaFiscal/etapaObservacoes/etapaHomologar
  await this.etapaDescricaoItem(ctx, existente, ndDocCod);
  ```
  Docstring: "Roda ANTES do com300/com131 de propósito: a ordem fiscal obrigatória é (a) fiscal → (b) obs → (c) homologar, e mexer no item depois de gerar as observações reabriria a pergunta de se elas continuam válidas. Falha aqui é fail-closed ANTES de qualquer coisa irreversível."
- **Impacto técnico**: o caminho síncrono paga +1 POST `com297/list` (200-500 ms p50) em 100% das execuções para proteger < 5% dos casos (aqueles em que o cadastro não deriva a descrição da DI). Alternativa "reativa" — deixar homologar, e só consertar em caso de rejeição SEFAZ — economizaria o round-trip no caso comum mas custaria: (a) uma homologação SEFAZ perdida (~vários segundos, contingência/SEFAZ), (b) re-download do status pós-rejeição, (c) reabrir o guard de idempotência do `geraObs`. A escolha atual está correta pelo custo esperado, mas vale registrar.
- **Impacto de negócio**: +300-500 ms p50 em toda emissão de NDe. Sobre um baseline de 6-15 s isto é ~3-5% — imperceptível para o analista. A alternativa reativa seria pior no caso ruim e não muito melhor no caso bom.
- **Métrica de baseline**: overhead marginal ~5% na latência sync total; ganho de reliability (fail-closed antes do irreversível) considerado dominante.

### F-performance-4: `preDescrProdutoNf` é chamado mesmo quando `prdDesNome` já poderia resolver localmente

- **Severidade**: P3 (baixo — micro-otimização com risco de mudar semântica; NÃO recomendar sem medir)
- **Tactic violada**: Reduce Overhead (parcial)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoNumerarioService.ts:1520-1541`
- **Evidência (objetiva)**: A cadeia de precedência do `resolverDescricaoItem` é: env → preDescr (HTTP) → prdDesNome (local) → default (local). No caso empty com `prdDesNome` presente (que é o vetor comum — o ERP conhece o produto), poderíamos pular a chamada HTTP a `preDescr` e ir direto para `prdDesNome`. Mas isso violaria a precedência de negócio: `preDescr` reflete a regra do cadastro do cliente (`dpeVld1DescrNfe`), que é MAIS correta que a descrição cadastrada crua.
- **Impacto técnico**: economizaria 1 GET (~300 ms p50) no caso empty. Mas a semântica está correta como está — o ERP deve mandar quando ele sabe.
- **Impacto de negócio**: irrelevante enquanto o caso empty for < 5%. Documentado para não ser "descoberto" e removido sem entender.
- **Métrica de baseline**: 1 GET evitável × ~5% dos casos × ~300 ms = ~15 ms de latência esperada média. Ganho invisível.

## 5. Cards Kanban

### [performance-1] Detectar página cheia em `listItensNde` (defesa contra crescimento silencioso)

- **Problema**
  > `listItensNde` faz um POST com `pageSize: 200` e nunca pagina. Se um dia a NDe crescer > 200 itens (mudança de cadastro ou de config do cliente), as linhas 201+ ficam invisíveis à etapa de conserto de descrição, e a homologação segue com um subconjunto corrigido. Silencioso.

- **Melhoria Proposta**
  > Em `ConexosNdeFiscalClient.listItensNde`, quando `rows.length === pageSize` (200), emitir `logService.warn` com `docCod`/`fisCod`/`rows.length` — flag para observabilidade, não bloqueio. Alternativamente, adotar paginação real (`pageNumber++` até `rows.length < pageSize`), mas só se o warn começar a disparar. Tactic Bass: Limit Event Response com feedback observável.

- **Resultado Esperado**
  > Latência inalterada no caso atual (N=1). Se um cliente produzir NDe > 200 itens, alerta imediato em log em vez de descoberta por chamado do analista. Métrica: 0 truncamentos silenciosos → 100% observáveis via warn.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - `# truncamentos silenciosos em `com297/comDocProdutos/list``: hoje 0 detectáveis → alvo 0 detectáveis com warn ativo
- **Risco de não fazer**: uma NDe grande futura será parcialmente corrigida sem sinal. Auditoria não consegue distinguir "consertamos" de "consertamos os primeiros 200".
- **Dependências**: nenhuma

### [performance-2] Paralelizar o loop `etapaDescricaoItem` quando N > 1 (com gate de N)

- **Problema**
  > O loop `for (item of itens)` é sequencial e faz 3 chamadas Conexos por item vazio. N=1 hoje, mas se um cliente novo produzir NDe multi-item vazia, a latência do caminho síncrono do analista cresce linearmente: ~1-1.5 s p50 × N; até ~30 s p99 × N (com timeout de 40 s por call e 2 retries).

- **Melhoria Proposta**
  > Substituir por `await Promise.all(itensVazios.map(async (item) => { ... }))` COM limite de concorrência (`p-limit` já disponível no stack, ou implementação inline: 5 em paralelo). Tactic Bass: Increase Concurrency. Preservar a serialização entre `preDescr`/`lerItem`/`gravarItem` DENTRO de cada item — a paralelização é entre itens, não dentro. Guardrail: se N > 20, degrada para sequencial (para não estourar o pool Conexos).

- **Resultado Esperado**
  > No caso hipotético N=10 vazios, latência p50 cai de ~10-15 s para ~1-1.5 s (paralelismo total dentro do gate). No caso atual N=1, comportamento idêntico (Promise.all de 1 elemento = sequencial).
  > Métrica: latência p50 da `etapaDescricaoItem` com N=10 empty: ~10 s → ~1-2 s.

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - latência `etapaDescricaoItem` p50 em N=10 empty: ~10 s → ~1-2 s
  - latência p50 em N=1 empty: ~1-1.5 s (inalterada)
- **Risco de não fazer**: se a Columbia começar a emitir NDe multi-item (mudança de cadastro do produto), o analista pode ver timeout HTTP no navegador antes de todo o loop rodar.
- **Dependências**: nenhuma; opcional aguardar F-performance-1 para saber quando N realmente cresce.

### [performance-3] Instrumentar contagem de "caso empty vs caso comum" para validar overhead esperado

- **Problema**
  > A justificativa da arquitetura ("chamada sempre, mesmo pagando 1 round-trip a mais") assume que o caso empty é raro (< 5%). Não há telemetria que valide isso em produção — o `logService.warn` só dispara no caso empty, mas não conta o total. Sem essa razão medida, o trade-off documentado é uma hipótese.

- **Melhoria Proposta**
  > Adicionar `logService.info` com `type: BUSINESS_INFO` no início de `etapaDescricaoItem` com `{ndDocCod, totalItens, itensVazios, itensPreenchidos}` — permite ao ObservabilityAdvisor derivar, do log, a proporção real de caso empty por semana. Custo: 1 log call, zero HTTP. Tactic Bass: nenhuma nova — é instrumentação para VALIDAR a decisão de F-performance-3.

- **Resultado Esperado**
  > Métrica derivável do log: `% NDe com dprLngDescrNf vazia` por semana. Confirma (ou refuta) a hipótese de "< 5% dos casos". Se refutada (> 30%), reabre F-performance-3 para reconsiderar arquitetura reativa (só consertar em rejeição SEFAZ).

- **Tactic alvo**: (observabilidade para validar tactics existentes)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - `% NDe empty` observável em produção: hoje = inobservável → alvo = queryable a partir de log
- **Risco de não fazer**: decisão de "pagar 1 round-trip sempre" fica sem validação empírica. Se a proporção mudar (mudança no cadastro do cliente), não temos como saber.
- **Dependências**: nenhuma

### [performance-4] Documentar a precedência de `resolverDescricaoItem` como intencional (não otimizar)

- **Problema**
  > A ordem `env → preDescr (HTTP) → prdDesNome (local) → default` chama HTTP mesmo quando `prdDesNome` está disponível localmente. Um revisor futuro pode "otimizar" pulando o HTTP quando `prdDesNome !== undefined`, mudando a semântica (preDescr aplica regra do cadastro do cliente `dpeVld1DescrNfe`; prdDesNome é a descrição crua). O código não explica por que a ordem importa.

- **Melhoria Proposta**
  > Adicionar comentário `// PRECEDÊNCIA INTENCIONAL — não reordenar; ver docstring do método` na linha entre a chamada `preDescr` e o fallback `prdDesNome`, referenciando o docstring já existente. Zero mudança comportamental. Tactic Bass: nenhuma — é defesa contra micro-otimização futura que degradaria a correção fiscal.

- **Resultado Esperado**
  > Nenhuma mudança de latência. Redução de risco de regressão fiscal por otimização mal-intencionada.

- **Tactic alvo**: (contramedida contra otimização perigosa)
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - `# de tentativas futuras de reordenar precedência sem entender`: ↓ (subjetivo, mas o comentário torna o revisor consciente)
- **Risco de não fazer**: alguém pula `preDescr` porque "prdDesNome já resolve"; NDe passa a gravar descrição crua no lugar da regra do cadastro do cliente; NF-e homologa com texto errado sem alarme.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo**: avaliei EXCLUSIVAMENTE o delta da branch `fix/nde-descricao-item` (novo cliente + nova `etapaDescricaoItem`). Não reavaliei o resto do `processarAlocacao` (baseline pré-existente da main).
- **Ordem de grandeza validada**: no caminho comum, o delta adiciona 1 POST Conexos (~300-500 ms p50). Sobre o baseline (~20-30 chamadas Conexos, ~6-15 s total), isto é ~3-5% de overhead. No caso raro empty, +3 chamadas (~1-1.5 s), ~10-15% de overhead. Aceito.
- **Métricas não coletadas**: proporção real de "empty vs preenchida" em produção — endereçada pelo card `performance-3`. Latência real por chamada Conexos — não medível localmente (sem métricas CloudWatch/APM neste stack Express).
- **Cross-QA para o consolidator**:
  - **Availability/Fault-Tolerance**: `preDescrProdutoNf` é best-effort (sem retry, engole erro) — decisão correta, MAS o `gravarDescricaoItemNde` usa `putGenericOnce` (sem retry). Se o PUT falhar por 5xx transitório, a etapa toda derruba o processarAlocacao inteiro. Verificar com qa-fault-tolerance se isso está OK dado que a etapa roda ANTES do fiscal/homologar (fail-closed intencional).
  - **Modifiability**: o `pageSize: 200` hardcoded (F-performance-1) e o limite de paralelismo do card `performance-2` são constantes que merecem ir para `EnvironmentVars` se um dia forem tunáveis.
  - **Testability**: o `etapaDescricaoItem` tem cobertura no `RecebimentoNumerarioService.test.ts` (187 linhas novas) e integração em `recebimentos.e2e.descricaoNfeNde.integration.test.ts` (356 linhas). Overhead em N>1 (F-performance-2) NÃO tem teste — o caso N=1 é o único exercitado.
