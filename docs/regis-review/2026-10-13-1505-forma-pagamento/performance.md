---
qa: Performance
qa_slug: performance
run_id: 2026-10-13-1505-forma-pagamento
agent: qa-performance
generated_at: 2026-10-13T15:05:00-03:00
scope: frontend
score: 9
findings_count: 2
cards_count: 1
---

# Performance — Regis-Review

Escopo: delta do PR #115 em `src/frontend` (modo `--quick`, sem build Next, sem `shared-metrics`). Não há Lambda/infra neste repo; as seções A–D do plano não se aplicam ao delta.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista SISPAG | Digita na busca / troca chip de forma de pagamento na aba "Títulos a pagar" | `useTabelaFiltro` (`tabela-filtro.tsx`), `filtroTitulos`, `FormaPagamentoBadge` | Carteira com ~1.260 títulos ativos, até ~11 categorias, 20 linhas/página | Recalcular filtro + chips e re-renderizar a página sem travar | Trabalho de filtro por tecla < 5 ms; custo adicional do delta no render < 1 ms/página |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Estabilidade do acessor `getCategoria` (dep dos memos) | Estável: `filtroTitulos` é const de módulo | Identidade estável entre renders | ✅ | `filtrosAbas.ts:39-46`; `page.tsx:377-383` |
| Estabilidade de `ordemCategorias` | Estável: `ORDEM_FORMA_DE_PAGAMENTO` é const de módulo | Idem | ✅ | `lib/sispag.ts:620-625` |
| Chamadas extras de `formaDePagamento` por tecla na busca | +1 por item de `semBoleto` (contagem) ≈ 1.260; mais 1.260 só se chip ≠ "todas" | O(n), n ≤ 1,5k | ✅ | `tabela-filtro.tsx` (`contagemCategorias`, `filtrados`) |
| Custo estimado do delta por tecla | ~0,1–0,3 ms (1.260 alocações de objeto + Map ≤ 11 chaves + sort ≤ 11 elementos). Estimativa analítica, não cronometrada | < 5 ms | ✅ | Análise de código |
| Custo base preexistente por tecla (filtro `semBoleto` com `getBuscaTexto().toLowerCase().includes`) | Domina o total: ~1–3 ms estimado para 1.260 linhas | — | ⚠️ **Não medível localmente** (sem profiler/browser em `--quick`) | `tabela-filtro.tsx:126-142` |
| Recomputo em render sem mudança de filtro | 0 (memos com deps estáveis; `items` vem de `useMemo`) | 0 | ✅ | `page.tsx:366-374` |
| Linhas com `FormaPagamentoBadge` por render | 20 (paginação) | ≤ 50 | ✅ | `page.tsx:1077` |
| Custo do badge | 1 chamada pura de `formaDePagamento` + `Badge`/span + ícone por linha: ≲ 0,05 ms/linha, ≲ 1 ms/página | < 2 ms/página | ✅ | `FormaPagamentoBadge.tsx` |
| Peso de bundle do delta | `Barcode` por import nomeado de `lucide-react` (tree-shake); sem dependência nova | 0 deps novas | ✅ | `FormaPagamentoBadge.tsx:1` |
| First Load JS de `/sispag` | ⚠️ **Não medível localmente**: build Next pulado (`--quick`). Recomendação: `cd src/frontend && npm run build` e comparar `/sispag` com main | p95 ≤ 200 KB | ⚠️ | — |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Sem debounce na busca; custo por tecla baixo (n ≈ 1,3k) o dispensa | N/A (n pequeno) | `tabela-filtro.tsx` |
| Limit Event Response | Paginação client-side em 20 linhas limita o render | ✅ presente | `page.tsx:377`, `pageSize` default 20 |
| Prioritize Events | Sem distinção entre eventos de UI | N/A (UI de baixa concorrência) | — |
| Reduce Overhead | Memos com deps estáveis; `contagemCategorias` reaproveita `semBoleto` (passe de filtro compartilhado) | ✅ presente | `tabela-filtro.tsx` |
| Bound Execution Times | Tudo O(n) sobre lista sem teto no cliente (comentário do hook cita ≤ 500; produção tem 1.260) | ⚠️ parcial | `tabela-filtro.tsx:105-108` |
| Increase Resource Efficiency | Um único passe com `Map` para contar categorias (evita O(n × categorias)) | ✅ presente | `contagemCategorias` |
| Increase Resources | N/A: renderização single-thread no cliente | N/A | — |
| Increase Concurrency | N/A no cliente | N/A | — |
| Maintain Multiple Copies of Computations | `useMemo` em `semBoleto`, `contagemCategorias`, `filtrados` | ✅ presente | `tabela-filtro.tsx` |
| Maintain Multiple Copies of Data | N/A para o delta | N/A | — |
| Bound Queue Sizes | N/A no frontend | N/A | — |
| Schedule Resources | N/A no frontend | N/A | — |
| Cache strategy | Memoização por deps; sem cache extra necessário | ✅ | — |
| Bundle leanness | Sem dep nova; import nomeado | ✅ | `FormaPagamentoBadge.tsx:1-2` |

## 4. Findings

### F-performance-1: contrato de estabilidade do acessor é só convenção (risco latente, sem regressão hoje)

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/frontend/app/permutas/components/tabela-filtro.tsx:112-118,147-165`; `src/frontend/app/sispag/components/filtrosAbas.ts:39`
- **Evidência (objetiva)**:
  ```
  deps de filtrados: [semBoleto, boleto, getBoleto, categoria, getCategoria]
  deps de contagemCategorias: [semBoleto, getCategoria, ordemCategorias]
  ```
  `getCategoria` e `ordemCategorias` entram nas deps; hoje ambos são const de módulo (estáveis). Um chamador futuro que passe `extras` inline anula os dois memos e refaz ~2 passes O(n) a cada render. O comentário do hook documenta o requisito, mas nada o impõe.
- **Impacto técnico**: Com n ≈ 1.260 o pior caso seria ~0,3–0,6 ms por render, imperceptível; só vira problema se n crescer 10x ou o acessor ficar caro.
- **Impacto de negócio**: Nenhum hoje.
- **Métrica de baseline**: 0 chamadores inline hoje (único usuário de `getCategoria` é `filtroTitulos`).

### F-performance-2: `filtrados` passa a sempre copiar o array e `contagemCategorias` aloca 1 objeto por item

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `tabela-filtro.tsx:166-176` (`filtrados`), `:150-158` (`formaDePagamento` devolve objeto novo; wrapper de `filtroTitulos` aloca outro)
- **Evidência (objetiva)**:
  ```
  antes: sem filtro de boleto -> retornava `semBoleto` (mesma referência, 0 trabalho)
  agora: semBoleto.filter(...) sempre, mesmo sem chip ativo
  ```
  Todas as demais abas (Permutas, Recebimentos, SISPAG) também pagam um `filter` O(n) com predicado trivial quando `semBoleto` muda.
- **Impacto técnico**: ≲ 0,1 ms por tecla para n = 1,3k; GC young-gen absorve as ~1.260 alocações curtas. A referência de `filtrados` muda só quando `semBoleto` muda, sem cascata de re-render.
- **Impacto de negócio**: Nenhum.
- **Métrica de baseline**: ~1.260 alocações + 1 cópia de array por mudança de filtro.

Sem finding sobre `FormaPagamentoBadge`: custo ≲ 1 ms por página de 20 linhas, memo desnecessário. O chip "Todos" faz `reduce` sobre ≤ 11 itens por render do `FiltroBarra`, irrelevante.

**Classificação: nenhum P0, nenhum P1, nenhum P2. Apenas 2 achados P3.**

## 5. Cards Kanban

### [performance-1] Curto-circuitar `filtrados` sem chip ativo e fixar o contrato de estabilidade em teste

- **Problema**
  > O refactor de `filtrados` em `useTabelaFiltro` perdeu o atalho que devolvia `semBoleto` sem copiar: toda aba faz um `filter` O(n) extra mesmo sem chip ativo (F-performance-2). A estabilidade do acessor `getCategoria` depende só de comentário (F-performance-1).

- **Melhoria Proposta**
  > Em `tabela-filtro.tsx`, retornar `semBoleto` direto quando `(!getBoleto || boleto === 'todos') && (!getCategoria || categoria === 'todas')` (tactic Reduce Overhead). Adicionar teste com `rerender` confirmando `filtrados === semBoleto` sem chip e `contagemCategorias` com a mesma referência entre renders sem mudança de estado.

- **Resultado Esperado**
  > Busca por tecla e troca de página sem chip ativo: 1 cópia de array de ~1.260 itens → 0; referência de `filtrados` estável. Ganho absoluto ≲ 0,1 ms por mudança de filtro (higiene, não latência perceptível).

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-2
- **Métricas de sucesso**:
  - Cópias de array em `filtrados` sem chip ativo: 1 → 0 por mudança de filtro
  - Teste de estabilidade de referência de `contagemCategorias`: ausente → presente
- **Risco de não fazer**: Nenhum relevante em 6 meses com ~1,3k títulos; só importa se a carteira passar de ~10k linhas ou se um chamador novo passar `extras` inline.
- **Dependências**: nenhuma

## 6. Notas do agente

- Modo `--quick`: sem build Next e sem profiler; custos são estimativas analíticas (n = 1.260 e ~11 categorias informados pelo caller), não cronometrados.
- Memo stability verificada: `filtroTitulos` e `ORDEM_FORMA_DE_PAGAMENTO` são const de módulo; `items` (`titulosFiltrados`) vem de `useMemo`; `filtroCandidatos` já usa `useMemo`.
- Cross-QA: Modifiability/Testability (contrato de estabilidade por convenção, F-performance-1). First Load JS de `/sispag` não medido; Deployability pode cobrir no build.
