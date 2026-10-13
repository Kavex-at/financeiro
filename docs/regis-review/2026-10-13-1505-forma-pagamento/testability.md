---
qa: Testability
qa_slug: testability
run_id: 2026-10-13-1505-forma-pagamento
agent: qa-testability
generated_at: 2026-10-13T15:05:00-03:00
scope: frontend
score: 8
findings_count: 3
cards_count: 2
---

# Testability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor | Altera a regra de forma de pagamento ou o filtro de categoria no hook compartilhado `useTabelaFiltro` | `lib/sispag.ts`, `tabela-filtro.tsx`, `filtrosAbas.ts`, `FormaPagamentoBadge.tsx`, `sispag/page.tsx` | CI local, jest + jsdom, sem rede | Teste existente falha se um ramo da regra mudar de comportamento | Ramos novos cobertos por asserção; 79/79 testes verdes nas 4 suítes tocadas |

## 2. Métricas observadas

(Modo `--quick`: cobertura numérica não rodada. Escopo limitado ao delta do PR #115.)

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (backend e frontend) | ⚠️ Não medível neste run (`--quick`) | 80% linhas em lógica de domínio | ⚠️ | n/a |
| Suítes do delta passando | 4/4 suítes, 79/79 testes | 100% | ✅ | `npx jest lib/sispag.test.ts app/permutas/components/tabela-filtro.test.tsx app/sispag/components/filtrosAbas.test.ts app/sispag/components/FormaPagamentoBadge.test.tsx` |
| Arquivos de produção do delta com teste dedicado | 4 de 5 (`page.tsx` só tem o `page.test.tsx` pré-existente) | 5 de 5 | ⚠️ | `git diff origin/main...HEAD --stat` |
| Ramos de `formaDePagamento` cobertos | 5 de 5 (boleto com DDA, boleto sem DDA, outra forma com e sem DDA, sem forma, código desconhecido) | 100% | ✅ | `lib/sispag.test.ts:677-719` |
| Ramos do `FormaPagamentoBadge` cobertos | 3 de 3 tons, mais o ramo `comDda` | 100% | ✅ | `FormaPagamentoBadge.test.tsx` |
| Combinações do filtro de categoria cobertas | categoria+filial, `limparFiltros`; faltam categoria+boleto, categoria+data, clique no chip, reset de página | 100% | ⚠️ | `tabela-filtro.test.tsx:128-186` |
| Asserções em `page.test.tsx` sobre a coluna ou os chips de forma | 0 | ≥1 | ⚠️ | `grep -n "forma" app/sispag/page.test.tsx` (só acha "Formar lotes") |
| Chamadas de rede reais nos testes do delta | 0 | 0 | ✅ | leitura dos testes |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `formaDePagamento` é função pura, e `getCategoria`/`ordemCategorias` entram no hook por parâmetro | ✅ presente | `lib/sispag.ts`, `tabela-filtro.tsx` |
| Recordable Test Cases | O caso real SSM 3679/1 (PRD, 13/10) virou teste | ✅ presente | `lib/sispag.test.ts` ("sem forma no Conexos") |
| Sandbox | Jest/jsdom, sem rede | ✅ presente | testes do delta |
| Executable Assertions | O hook devolve `setCategoria` só quando `getCategoria` existe, e há teste disso (`setBoleto` undefined) | ⚠️ parcial | `tabela-filtro.test.tsx:152` |
| Abstract Data Sources | Dados entram por props e parâmetros | ✅ presente | `FormaPagamentoBadge` usa `Pick<TituloAPagar,...>` |
| Limit Structural Complexity | A lógica saiu do JSX de `page.tsx` (-50 linhas) para função pura e componente | ✅ presente | `page.tsx` diff |
| Limit Non-Determinism | Sem tempo, sem aleatoriedade e sem rede no delta | ✅ presente | diff |

## 4. Findings (achados)

Nenhum P0: as regras de negócio do delta (classificação, contagem, ordem, ramos do badge) estão cobertas e verdes. Os achados abaixo são lacunas de teste em comportamento novo, sem risco de dinheiro ou de escrita no ERP.

### F-testability-1: Combinações do filtro de categoria e interação via UI sem teste

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/frontend/app/permutas/components/tabela-filtro.tsx` (filtro combinado, `setCategoria`), `tabela-filtro.test.tsx:128-186`
- **Evidência (objetiva)**:
  ```
  O predicado novo é: (getBoleto passa) && (categoria passa).
  Os testes só combinam categoria com filial. Ficam sem teste:
  - boleto + categoria
  - data + categoria
  - setCategoria voltando a pagina para 1 (setPagina(1))
  - clique no chip chamando setCategoria (o teste de FiltroBarra só confere a renderização)
  - dicaCategoria renderizada
  ```
- **Impacto técnico**: O refactor do `filter` alterou o caminho de boleto, que as abas de permutas usam. Os testes de boleto antigos protegem isso, mas nada trava a conjunção com categoria.
- **Impacto de negócio**: Uma regressão aqui faz o analista ver uma contagem de chip diferente das linhas da tabela, em tela de pagamento.
- **Métrica de baseline**: 0 de 5 comportamentos listados com asserção.

### F-testability-2: Categoria selecionada que some da lista deixa a tabela vazia, sem teste

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `tabela-filtro.tsx` (`contagemCategorias` derivada de `semBoleto`; `categoria` é estado)
- **Evidência (objetiva)**:
  ```
  Escolher a categoria 'x' e depois trocar a filial ou a busca, de modo que 'x' fique com 0 linhas.
  O chip 'x' desaparece de contagemCategorias, mas categoria continua 'x'.
  Resultado: 0 linhas e nenhum chip marcado. Só "Todos" ou limparFiltros recuperam.
  Nenhum teste fixa o comportamento esperado (reset ou chip fantasma).
  ```
- **Impacto técnico**: Estado inconsistente entre estado e chips, e o comportamento correto nunca foi decidido nem travado por teste.
- **Impacto de negócio**: O analista pode achar que a carteira está vazia.
- **Métrica de baseline**: 0 testes para o cenário.

### F-testability-3: A fiação da página (coluna e chips de forma) não tem asserção

- **Severidade**: P2
- **Tactic violada**: Specialized Interfaces
- **Localização**: `src/frontend/app/sispag/page.tsx` (`rotuloCategoria`, `dicaCategoria`, `<TableHead>Forma de pagamento`, `<FormaPagamentoBadge>`), `page.test.tsx`
- **Evidência (objetiva)**:
  ```
  grep -n "forma" app/sispag/page.test.tsx -> só "Formar lotes".
  Apagar rotuloCategoria ou trocar o cabeçalho da coluna não quebra nenhum teste.
  ```
- **Impacto técnico**: As peças isoladas estão testadas, mas a ligação (filtro dos títulos com `filtroTitulos` e chips, mais a coluna) só é validada manualmente.
- **Impacto de negócio**: O recurso é a visão pedida pelo analista (boleto sem DDA). Perdê-lo em silêncio reabre o bug de remessa sem código de barras.
- **Métrica de baseline**: 0 asserções de página sobre a coluna ou os chips de forma.

## 5. Cards Kanban

### [testability-1] Cobrir combinações e interação do filtro de categoria

- **Problema**
  > O filtro de categoria do hook compartilhado só é testado com filial. Boleto+categoria, data+categoria, o clique no chip e o reset de página não têm asserção, e o cenário de categoria que some (F-testability-2) não tem comportamento definido.
- **Melhoria Proposta**
  > Em `tabela-filtro.test.tsx`, acrescentar:
  > - um caso com `getBoleto` e `getCategoria` juntos;
  > - um caso com data mais categoria;
  > - um clique no chip via `userEvent`, conferindo `aria-pressed` e as linhas;
  > - o reset para a página 1;
  > - o cenário "categoria sai da lista" (decidir se reseta para `todas`) e `dicaCategoria`.
- **Resultado Esperado**
  > Comportamentos novos do hook com asserção: 0 de 6 → 6 de 6.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1, F-testability-2
- **Métricas de sucesso**:
  - Casos em `describe('useTabelaFiltro — categoria')`: 4 → 9
- **Risco de não fazer**: Regressão silenciosa no hook usado por várias abas de permutas e SISPAG.
- **Dependências**: nenhuma

### [testability-2] Travar a fiação de forma de pagamento em `sispag/page.test.tsx`

- **Problema**
  > Nada garante que a página liga os chips "Forma de pagamento" nem a coluna com o badge.
- **Melhoria Proposta**
  > Com o mock de carteira que `page.test.tsx` já usa, abrir a aba de títulos e afirmar:
  > - o cabeçalho "Forma de pagamento";
  > - os chips (`boleto sem DDA (n)`);
  > - o texto da dica.
- **Resultado Esperado**
  > Asserções de página sobre a forma de pagamento: 0 → 3.
- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Asserções de página sobre forma de pagamento: 0 → 3
- **Risco de não fazer**: Perda silenciosa do alerta "boleto sem DDA" em um refactor da página.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta do PR #115 no frontend. Cobertura numérica não rodada (`--quick`), então a métrica 1 está declarada não medível.
- Há 0 P0. Os ramos de negócio (`formaDePagamento` e o badge) estão cobertos, incluindo o caso real SSM 3679/1.
- Cross-QA: a decisão do cenário F-testability-2 (reset ou chip fantasma) toca Modifiability, porque o hook é compartilhado entre as abas de permutas e SISPAG.
