---
qa: Performance
qa_slug: performance
run_id: 2026-10-27-1546
agent: qa-performance
generated_at: 2026-10-27T15:57:33Z
scope: backend
score: 8
findings_count: 0
cards_count: 0
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista | Retomar lote com G grupos previamente rejeitados | Guarda anterior e preparação sequencial | Express/Render com Conexos lento ou lote paginado | Ler cabeçalho e grid limitado; bloquear sem mutação antiga se inconclusivo | ≤40 páginas de 500 por leitura de grid; 0 reenvios autorizados por truncamento; medir duração no HML |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Limite de paginação por leitura do lote anterior | 40 páginas × 500 = 20.000 linhas (limite estático) | Limite finito e erro quando não comprova ausência | ✅ | `src/backend/domain/client/ConexosSispagWriteClient.ts:809-845,860,927-930` |
| Custo lógico de uma guarda | 1 cabeçalho + P páginas, 1≤P≤40; 0 páginas se cabeçalho falha | Custo explícito; sem remoção da checagem de segurança | ✅ | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043-1059` |
| Guardas na primeira adoção permitida | Até 2: antes da adoção e em seguir; portanto até 2×(1+P) leituras lógicas por grupo | Preservar revalidação; medir antes de otimizar | ⚠️ | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:639,980,1133` |
| Processamento dos grupos | Sequencial; custo adicional O(G×P) | Sem concorrência de escrita introduzida | ✅ | `src/backend/domain/service/sispag/RemessaService.ts:1404-1412` |
| Timeout HTTP compartilhado | 40.000 ms por chamada; retry de leitura com até 2 tentativas | Nenhuma chamada externa sem timeout | ✅ | `src/backend/services/conexos.ts:116-121`; `src/backend/domain/client/ConexosBaseClient.ts:156-166` |
| Latência p50/p95, volume G/P e duração ponta a ponta pós-correção | Não medidos | Coletar no roteiro HML antes de definir orçamento por lote | ⚠️ | Escopo quick em `_shared-metrics.md` |
| Dependências runtime backend | 17, métrica compartilhada; delta não adiciona dependências | Sem crescimento neste delta | ✅ | `_shared-metrics.md`; `git diff --stat` |

⚠️ **Não medível localmente**: latência real, throughput, ocupação de workers, custo monetário, índices/planos do banco e distribuição dos tamanhos de lote. Requer ambiente instrumentado e amostra representativa. O limite de chamadas lógicas não é limite de requisições físicas: retry, autenticação e reconexão podem adicionar chamadas. Não foi executado benchmark nem extrapolado p95 a partir de mocks.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: validação por ação, sem amostragem; não se amostra prova de liberação | N/A | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1004` |
| Limit Event Response | Falha de cabeçalho ou item presente encerra guarda sem importação | ✅ presente | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1044-1065` |
| Prioritize Events | N/A: delta não introduz fila nem prioridade de eventos | N/A | `CLAUDE.md` (Express request/response) |
| Reduce Overhead | Revalidação deliberada na adoção e retomada; não há medição de custo excedente | ⚠️ parcial | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:639,980` |
| Bound Execution Times | Timeout por HTTP e teto de páginas; orçamento total por lote não medido | ⚠️ parcial | `src/backend/services/conexos.ts:121`; `src/backend/domain/client/ConexosSispagWriteClient.ts:860` |
| Increase Resource Efficiency | Bloqueio evita importação/finalização sabidamente inviável; varre lote por grupo | ⚠️ parcial | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1059`; `src/backend/domain/service/sispag/RemessaService.ts:1404` |
| Increase Resources | N/A: sem mudança de capacidade Render neste delta | N/A | `_shared-metrics.md` |
| Increase Concurrency | N/A: nenhuma necessidade medida de paralelizar; sequência protege fluxo financeiro | N/A | `src/backend/domain/service/sispag/RemessaService.ts:1404` |
| Maintain Multiple Copies of Computations | N/A: guarda precisa reler estado vivo; memoizar pode invalidar a prova | N/A | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043` |
| Maintain Multiple Copies of Data | N/A: ledger não substitui presença/ausência viva no ERP | N/A | `src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts:1043-1059` |
| Bound Queue Sizes | N/A: sem fila/SQS no runtime atual ou no delta | N/A | `CLAUDE.md` |
| Schedule Resources | N/A: sem scheduler ou processamento agendado nesta correção | N/A | `CLAUDE.md` |

Cold start/bundle Lambda não se aplica ao Express atual. Cache do resultado da guarda não foi introduzido, coerente com a exigência de leitura viva. Índices SQL e bundle frontend não mudaram no recorte; nenhum plano de consulta nem build frontend foi executado.

## 4. Findings (achados)

Nenhum achado de degradação mensurável no delta. A varredura por grupo e a segunda revalidação na adoção têm custo estático identificável, mas não demonstram gargalo com o volume real desconhecido. Não classificar essas leituras de segurança como N+1 crítico nem remover revalidação para reduzir chamadas. A medição de latência deve acompanhar a prova HML já exigida no plano, sem criar card duplicado ou meta p95 arbitrária.

## 5. Cards Kanban

Nenhum card novo de Performance: não houve medição de latência nem evidência suficiente de gargalo que justifique otimização. Registrar duração total, número de grupos e páginas no roteiro HML existente permitirá avaliar orçamento e necessidade de melhoria sem enfraquecer a guarda.

## 6. Notas do agente

Quick local: inspeção estática e métricas compartilhadas, sem repetir gates ou chamar ERP/banco.
Timeouts se conectam a Availability/Fault Tolerance; não há chamada ilimitada nova demonstrada.
Custo O(G×P) é derivação do código, não benchmark nem p95 de produção.
HML pós-correção permanece pendente; testes mockados não provam desempenho nem liberação real.
Sem avaliação de dívida preexistente alheia ao reenvio rejeitado.
