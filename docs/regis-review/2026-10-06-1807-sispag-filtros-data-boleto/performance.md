---
qa: Performance
qa_slug: performance
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-performance
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 9
findings_count: 3
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Columbia | Troca o de/até de vencimento ou o chip de boleto nas abas do SISPAG | `GET /sispag/boletos-dda` (`PaginacaoBoletoDda.paginar`) e `useTabelaFiltro` (`tabela-filtro.tsx`) | Operação normal, escopo "todos" do DDA (~24 mil linhas), listas do painel com até ~500 linhas | Filtro aplicado sem varrer o pool inteiro no navegador nem inflar a resposta; sem travar a digitação | Resposta DDA continua limitada a `BOLETO_DDA_TAMANHO_MAX` (100 linhas/página); filtro cliente < 16 ms por interação (1 frame) para 500 linhas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas dependências runtime (delta) | 0 | 0 | ✅ | `_shared-metrics.md` ("no new dependency") |
| Queries SQL novas / N+1 novos | 0 (filtro puro em memória, sem repositório) | 0 | ✅ | `PaginacaoBoletoDda.ts:81-90`; `git show --stat 65d1fdf` |
| Custo extra por requisição DDA do filtro de vencimento | +1 comparação de string por linha (O(n), n ≈ 24 mil), sem alocação, avaliado antes de `textoDeBusca` | desprezível frente à busca (~24 mil `textoDeBusca`) | ✅ | `PaginacaoBoletoDda.ts:83-90` |
| Tamanho de resposta DDA | teto 100 linhas (inalterado) | ≤ 100 | ✅ | `PaginacaoBoletoDda.ts:11` |
| `Intl.DateTimeFormat` instanciado por linha | 0 (instância única em módulo) | 0 | ✅ | `filtroDatas.ts:14` |
| Memoização do filtro no cliente | `semBoleto`, `contagemBoleto`, `filtrados`, `slice` em `useMemo`; acessores de `extras` estáveis (módulo ou `useMemo`) | estáveis | ✅ | `tabela-filtro.tsx:92-139`; `page.tsx` (`extrasCandidatos`) |
| Aba REM sem paginação antes do delta | agora paginada (`abaRem.slice`) | paginada | ✅ (melhoria) | `page.tsx` diff |
| Disparos de fetch por mudança de data no DDA | 1 por alteração de De/Até, sem debounce (a busca textual tem debounce) | ≤ 1 por intenção | ⚠️ | `BoletosDdaTab.tsx` (setters de data mudam `chave`) |
| Bundle frontend (First Load JS) | ⚠️ **Não medível nesta revisão**: `next build` não executado; delta sem dependência nova, +190 linhas em `tabela-filtro.tsx`, +1 em `date-picker.tsx` | p95 ≤ 200 KB | ⚠️ | Requer `cd src/frontend && npm run build`. Recomendação: registrar o First Load JS da rota `/sispag` no `_shared-metrics.md` |
| Cold start / Lambda / pool / SQS | ⚠️ **Não medível**: sem `infra/` e sem Lambda; delta não toca Pool, SQS nem clients externos | n/a | ⚠️ | `CLAUDE.md` (Layout do repositório) |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Busca do DDA com debounce; datas sem debounce | ⚠️ parcial | `BoletosDdaTab.tsx` (`buscaAplicada`) |
| Limit Event Response | Filtro de vencimento reduz o conjunto antes de paginar; resposta limitada a 100 linhas | ✅ presente | `PaginacaoBoletoDda.ts:80-109` |
| Prioritize Events | N/A: delta é de leitura/filtro, sem fila de eventos | N/A | — |
| Reduce Overhead | `Intl` hoistado; `valorBr` manual; memo em cascata no hook | ✅ presente | `filtroDatas.ts:14`; `tabela-filtro.tsx:92-139` |
| Bound Execution Times | Sem chamada externa nova; filtro O(n) em memória | ✅ presente | `PaginacaoBoletoDda.ts` |
| Increase Resource Efficiency | `vencimentoOk` antes da busca textual (curto-circuito do `&&`); `getDatas` aloca um array por linha por recomputação (≤ 500 linhas) | ✅ presente | `tabela-filtro.tsx:99-108` |
| Increase Resources / Increase Concurrency | N/A: sem Lambda/infra neste repo | N/A | — |
| Maintain Multiple Copies of Computations | N/A: nada a replicar no delta | N/A | — |
| Maintain Multiple Copies of Data | Filtros de títulos/lotes/REM/RET operam sobre a cópia já carregada no cliente; DDA sobre lista consolidada no servidor, sem cache entre requisições (herdado) | ⚠️ parcial | `page.tsx` (`useTabelaFiltro` por aba); `PaginacaoBoletoDda.paginar` |
| Bound Queue Sizes | N/A: sem fila no delta; paginação limita a saída (DDA 100; REM agora paginada) | N/A | — |
| Schedule Resources | N/A: sem job/EventBridge no delta | N/A | — |
| Cache strategy | Sem cache da lista consolidada do DDA (herdado, não introduzido) | ⚠️ parcial | `BoletoDdaService.listar` |
| Index discipline | N/A: sem SQL novo | N/A | — |
| Bundle leanness | 0 dependências novas | ✅ presente | `_shared-metrics.md` |

## 4. Findings (achados)

### F-performance-1: Datas do DDA disparam um GET por alteração, sem debounce

- **Severidade**: P3
- **Tactic violada**: Manage Sampling Rate
- **Localização**: `src/frontend/app/sispag/components/BoletosDdaTab.tsx` (setters `setDataDe`/`setDataAte`; `chave` inclui o filtro)
- **Evidência (objetiva)**:
  ```
  setDataDe: (v) => { setVencimentoDe(v); setPagina(1) }
  setDataAte: (v) => { setVencimentoAte(v); setPagina(1) }
  // busca textual passa por buscaAplicada (debounce); datas entram direto em `filtro` -> `chave`
  ```
- **Impacto técnico**: cada mudança de data refaz o `paginar` sobre ~24 mil linhas no servidor. O `<input type="date">` só emite onChange com data completa, então o excesso é pequeno.
- **Impacto de negócio**: desprezível hoje (poucos analistas); vira ruído se o seletor for navegado por setas.
- **Métrica de baseline**: 1 requisição por alteração de data; 0 ms de debounce (busca textual: debounce existente).

### F-performance-2: Filtro de datas dos lotes candidatos aloca arrays por linha a cada recomputação

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `src/frontend/app/sispag/components/filtrosAbas.ts` (`filtroCandidatos`); `tabela-filtro.tsx:99-123`
- **Evidência (objetiva)**:
  ```
  getDatas: (l) => l.itens.map((i) => diaDoErp(i.vencimento)),
  getBoleto: (l) => l.itens.map((i) => i.modalidade === 'BOLETO' || comBoleto.has(chave(i))),
  // getBoleto roda até 3x por lote (contagemBoleto + filtrados com/sem)
  ```
- **Impacto técnico**: `diaDoErp` faz `new Date().toISOString()` por item. Memoizado, só roda quando muda filtro ou lista; custo estimado em microssegundos a poucos ms para dezenas de lotes (não cronometrado).
- **Impacto de negócio**: nenhum perceptível.
- **Métrica de baseline**: ≤ 500 linhas por lista, custo estimado < 5 ms por recomputação. Sem card: abaixo do limiar de ação; revisitar se as listas passarem de ~2 mil linhas.

### F-performance-3: Lista consolidada do DDA é refiltrada do zero a cada requisição (herdado)

- **Severidade**: P3
- **Tactic violada**: Maintain Multiple Copies of Data (cache)
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:62-118`, `BoletoDdaService.listar`
- **Evidência (objetiva)**:
  ```
  paginar(linhas, filtro) // linhas = pool completo (~24.137 no escopo "todos"); filtra, conta e fatia por requisição
  ```
- **Impacto técnico**: o delta acrescenta uma dimensão de filtro (vencimento) que aumenta a taxa de requisições distintas sobre o mesmo pool, sem custo por requisição relevante. O custo dominante continua sendo `textoDeBusca` com busca ativa (já otimizado em 2026-09-24).
- **Impacto de negócio**: baixo. Latência do DDA não foi medida neste ciclo.
- **Métrica de baseline**: ⚠️ p95 de `GET /sispag/boletos-dda` não medido localmente; requer log/APM de produção (Render).

## 5. Cards Kanban

### [performance-1] Aplicar debounce às datas de vencimento do DDA e medir a latência do endpoint

- **Problema**
  > Datas de vencimento do DDA disparam um GET por alteração (F-performance-1) e a latência p95 de `GET /sispag/boletos-dda` com filtro de vencimento no escopo "todos" nunca foi registrada (F-performance-3), então não há evidência de que o filtro novo fique dentro do orçamento.

- **Melhoria Proposta**
  > Reusar o mecanismo de debounce da busca (`buscaAplicada`) para `vencimentoDe`/`vencimentoAte` em `BoletosDdaTab.tsx` (Manage Sampling Rate). Registrar a duração de `paginar` e o `total` retornado via `LogService` para obter p50/p95 reais.

- **Resultado Esperado**
  > Menos requisições redundantes por interação de data e uma linha de base de latência do endpoint em produção.

- **Tactic alvo**: Manage Sampling Rate
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1, F-performance-3
- **Métricas de sucesso**:
  - Requisições por troca de intervalo De/Até no DDA: 2 a 4 -> ≤ 2 (agrupadas pelo debounce)
  - p95 de `GET /sispag/boletos-dda` (escopo "todos", com vencimento): não medido -> medido e ≤ 500 ms
- **Risco de não fazer**: carga redundante sobre o pool de 24 mil linhas se o uso crescer; regressão de latência sem baseline para detectá-la.
- **Dependências**: nenhuma.

### [performance-2] Registrar o First Load JS das rotas /sispag e /permutas em cada ciclo

- **Problema**
  > O delta soma ~190 linhas ao kit compartilhado `tabela-filtro.tsx`, carregado também pela rota `/permutas`, e o tamanho do bundle não foi medido neste ciclo (F-performance-2 trata do custo de runtime; o de bundle segue sem baseline).

- **Melhoria Proposta**
  > Executar `cd src/frontend && npm run build` e anexar a tabela de First Load JS de `/sispag` e `/permutas` ao `_shared-metrics.md`; alertar se p95 > 200 KB (Bundle leanness).

- **Resultado Esperado**
  > Bundle das duas rotas medido e comparável entre ciclos.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - First Load JS `/sispag`: não medido -> medido, alvo ≤ 200 KB
  - First Load JS `/permutas`: não medido -> medido; delta vs. main ≤ +2 KB
- **Risco de não fazer**: crescimento silencioso do bundle do kit de filtro compartilhado ao longo dos ciclos.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: apenas o delta (65d1fdf, da095fa). Nenhum P0/P1: sem SQL, sem chamada externa, sem dependência, resposta DDA segue limitada a 100 linhas.
- F-performance-2 tem card apenas pelo lado do bundle (performance-2); o custo de runtime fica sem ação de propósito (listas ≤ 500 linhas).
- Não medido: `next build` (bundle), latência de produção do DDA, cold start/pool/SQS (sem `infra/`).
- Cross-QA: a regex Zod valida o formato mas não a validade do calendário nem `De <= Ate` (Security/Integrability, impacto só de resultado vazio).
