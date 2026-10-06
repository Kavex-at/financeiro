---
qa: Availability
qa_slug: availability
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-availability
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 8
findings_count: 2
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

Escopo: apenas o delta dos commits `65d1fdf` e `da095fa` (filtros de data e de boleto nas abas do SISPAG; filtro de vencimento no servidor em `GET /sispag/boletos-dda`).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista (browser) ou cliente HTTP | Envia `vencimentoDe`/`vencimentoAte` malformados, invertidos (de > até) ou semanticamente inválidos (`2026-13-45`) | `GET /sispag/boletos-dda` (`routes/sispag.ts`, `PaginacaoBoletoDda`) | Operação normal, pool DDA em memória | Entrada malformada é rejeitada com 400 (Exception Prevention); entrada inconsistente não derruba o processo nem dispara chamada externa | 0 erros 5xx causados pelos novos parâmetros; 0 escritas no Conexos/Nexxera; latência inalterada (filtro O(n) em memória) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas chamadas externas (Conexos/Nexxera/GED/SharePoint) no delta | 0 | 0 (delta de filtro não deve ampliar superfície) | ✅ | `git show --stat 65d1fdf da095fa`; `_shared-metrics.md` ("no Conexos write, no new endpoint") |
| Novas escritas/mutações de estado no delta | 0 (somente leitura/filtro) | 0 | ✅ | `PaginacaoBoletoDda.ts` (função pura), `BoletoDdaService.ts:77-81` |
| Novos parâmetros de entrada validados por Zod | 2 de 2 (`vencimentoDe`, `vencimentoAte`) | 100% | ✅ | `src/backend/routes/sispag.ts:873-876` |
| Validação semântica de data (calendário / de ≤ até) | 0 de 2 (só formato `^\d{4}-\d{2}-\d{2}$`) | 100% | ⚠️ | `PaginacaoBoletoDda.ts` `DATA_CIVIL_REGEX` |
| Novos clients externos com timeout | N/A (nenhum client novo) | 100% | ✅ | delta sem `axios`/`fetch` no backend |
| Cobertura de testes do delta | 4 arquivos de teste tocados/novos (+327 linhas); backend 4010 passed, frontend 859 passed | verde | ✅ | `_shared-metrics.md` |
| DLQ / alarmes CloudWatch / `infra/` | não existe `infra/` no repo | n/a | ⚠️ | `CLAUDE.md` (layout) |

> ⚠️ **Não medível localmente**: DLQ coverage, alarmes por tenant, MTTR real, taxa de erro 4xx/5xx de `/sispag/boletos-dda`. Não há `infra/`/Terraform (deploy Render) e métricas de produção exigem logs do Render. Recomendação: instrumentar contagem de 400 por rota e tempo `candidato → conciliado` do lote SISPAG.

> ⚠️ **Não medível localmente**: tamanho do pool DDA em memória em produção (impacta custo do filtro O(n) por requisição). Requer consulta ao banco de produção.

## 3. Tactics — Cobertura no financeiro

Avaliadas no contexto do delta; tactics sistêmicas (infra, redundância) não são alteradas por ele.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Não tocado pelo delta; sem health-check específico | ❌ ausente | N/A no delta |
| Heartbeat | Sem scheduler/heartbeat (jobs rodados via cron externo) | ❌ ausente | CLAUDE.md "Scheduler/Jobs" |
| Monitor | Sem `infra/`; delta não adiciona métricas | ❌ ausente | repo sem Terraform |
| Timestamp | Delta compara datas civis ISO por string; frontend separa dia ERP vs. instante (Brasília) | ✅ presente | `src/frontend/app/sispag/components/filtroDatas.ts:10-31` |
| Sanity Checking | Regex de formato valida a entrada, mas não calendário nem de ≤ até | ⚠️ parcial | `routes/sispag.ts:873-876`; F-availability-1 |
| Condition Monitoring | Não aplicável ao delta | N/A | filtro puro, sem recurso a monitorar |
| Voting | Não aplicável: sem componentes redundantes computando o mesmo resultado | N/A | — |
| Exception Detection | 400 com `error.flatten()` para query inválida | ✅ presente | `routes/sispag.ts:889-892` |
| Self-Test | Sem self-test; mitigado por testes unitários do filtro | ⚠️ parcial | `PaginacaoBoletoDda.test.ts`, `sispag.test.ts` |
| Active Redundancy | Não aplicável ao delta (Render, instância única) | N/A | — |
| Passive Redundancy | Não aplicável ao delta | N/A | — |
| Spare | Não aplicável ao delta | N/A | — |
| Exception Handling | `asyncHandler` já cobre a rota; filtro puro não lança | ✅ presente | `routes/sispag.ts:884` |
| Rollback | Delta não faz escrita; reversão por revert de commit | ✅ presente | `_shared-metrics.md` (sem migration) |
| Software Upgrade | Fora do escopo do delta | N/A | — |
| Retry | Sem I/O externo novo, logo nada a retentar | N/A | delta sem chamadas externas |
| Ignore Faulty Behavior | Boleto sem vencimento sai quando há intervalo ativo (comportamento definido e documentado) | ✅ presente | `PaginacaoBoletoDda.ts:98-103` |
| Degradation | Resultado vazio com mensagem "Ajuste ... o vencimento" em vez de erro | ✅ presente | `BoletosDdaTab.tsx:327-331` |
| Reconfiguration | Fora do escopo do delta | N/A | — |
| Shadow | Fora do escopo do delta | N/A | — |
| State Resynchronization | Delta não altera estado de sincronização DDA (`sincronizar` intacto) | N/A | `BoletoDdaService.ts` |
| Escalating Restart | Fora do escopo do delta | N/A | — |
| Non-Stop Forwarding | Fora do escopo do delta | N/A | — |
| Removal from Service | Fora do escopo do delta | N/A | — |
| Transactions | Sem mutações no delta | N/A | — |
| Predictive Model | Ausente (fora do escopo) | ❌ ausente | — |
| Exception Prevention | Zod regex impede strings arbitrárias; comparação por string nunca chega a SQL | ✅ presente | `routes/sispag.ts:871-876` |
| Increase Competence Set | Resultado de intervalo invertido/inexistente é vazio, não erro | ⚠️ parcial | F-availability-1 |

## 4. Findings (achados)

### F-availability-1: Validação de data só por formato; intervalo invertido e datas inexistentes passam em silêncio

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Sanity Checking
- **Localização**: `src/backend/routes/sispag.ts:873-876`; `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` (`DATA_CIVIL_REGEX`, `vencimentoOk`)
- **Evidência (objetiva)**:
  ```
  vencimentoDe: z.string().regex(DATA_CIVIL_REGEX).optional(),
  vencimentoAte: z.string().regex(DATA_CIVIL_REGEX).optional(),
  // DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/  -> aceita 2026-13-45 e de > até
  ```
- **Impacto técnico**: `2026-13-45` e `de > até` retornam 200 com lista vazia, em vez de 400. Sem risco de crash ou injeção (comparação por string, sem SQL, conforme comentário na rota).
- **Impacto de negócio**: um cliente HTTP que não seja o `<input type="date">` do próprio front pode interpretar "0 boletos" como "nada a pagar". A UI oficial não gera esses valores.
- **Métrica de baseline**: 0 de 2 parâmetros com validação semântica; 0 incidentes possíveis pela UI atual (input `type="date"` restringe o valor).

### F-availability-2: Filtro de vencimento reavalia o pool DDA inteiro em memória a cada request

- **Severidade**: P3 (baixo — melhoria opcional)
- **Tactic violada**: Exception Prevention (prevenção de degradação por carga)
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:94-110`
- **Evidência (objetiva)**:
  ```
  const semSituacao = linhas.filter((b) => { ... vencimentoOk(b) ... });
  // linhas = pool DDA completo; a página (<=100) é cortada depois de filtrar
  ```
- **Impacto técnico**: custo O(n) por request, acrescido de uma passada simples pelo delta. Padrão já existente (filial/busca/situação); o delta não muda a ordem de grandeza.
- **Impacto de negócio**: sem efeito observável hoje. Só importa se o pool DDA crescer em ordens de grandeza.
- **Métrica de baseline**: tamanho real do pool não medível localmente (ver seção 2). Sem número, mantido em P3.

## 5. Cards Kanban

### [availability-1] Rejeitar com 400 datas inexistentes e intervalo invertido em `/sispag/boletos-dda`

- **Problema**
  > O Zod valida só o formato `YYYY-MM-DD`; `2026-13-45` ou `vencimentoDe > vencimentoAte` retornam 200 com lista vazia (F-availability-1). Clientes que não usam o date-picker da UI podem ler "vazio" como "sem boletos".

- **Melhoria Proposta**
  > Em `boletosDdaSchema` (`routes/sispag.ts`), trocar o regex por `refine` que valida o calendário (ex.: `Date.parse` + round-trip ISO) e adicionar `superRefine` impondo `vencimentoDe <= vencimentoAte`. Tactic: Sanity Checking. Adicionar 2 casos a `sispag.test.ts`.

- **Resultado Esperado**
  > Entradas inconsistentes retornam 400 com `details`. Parâmetros de data com validação semântica: 0 de 2 → 2 de 2.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Parâmetros de data com validação semântica: 0/2 → 2/2
  - Casos de teste de rejeição: 0 → 2
- **Risco de não fazer**: baixo; eventual confusão de integrador externo ou script ad-hoc que passe datas erradas.
- **Dependências**: nenhuma

### [availability-2] Medir o tamanho do pool DDA e a latência de `/sispag/boletos-dda`

- **Problema**
  > O filtro roda em memória sobre o pool inteiro (F-availability-2) e não há métrica local de tamanho de pool nem de latência da rota. Sem número, não dá para saber quando o padrão deixa de ser seguro.

- **Melhoria Proposta**
  > Logar via `LogService` o total de linhas do pool e a duração do `listar` (campo estruturado), e registrar um limiar de revisão (ex.: pool > N linhas → mover filtro para SQL parametrizado). Tactic: Exception Prevention.

- **Resultado Esperado**
  > Tamanho do pool e p95 da rota passam de "não medido" a "medido"; decisão de migrar para SQL baseada em dado.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Pool DDA monitorado: não medido → medido
  - p95 de `/sispag/boletos-dda`: não medido → medido
- **Risco de não fazer**: degradação gradual descoberta pelo analista, não por um alarme.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta; sem P0/P1: não há escrita, chamada externa, migration, nem SQL novo, e a entrada é validada por Zod (`routes/sispag.ts:873-876`).
- Métricas de infra (DLQ, alarmes, timeouts de clients) marcadas como não aplicáveis ao delta ou não mensuráveis (sem `infra/`); não foram reexecutadas as inspeções sistêmicas.
- Cross-QA: o F-availability-1 também toca security (Exception Prevention na validação de entrada) e testability.
