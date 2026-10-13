---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-13-1505-forma-pagamento
agent: qa-modifiability
generated_at: 2026-10-13T15:30:00-03:00
scope: frontend
score: 7
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

> Versão pequena (--quick), só o delta do PR #115 em `src/frontend`. **Não há P0.**

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / analista de negócio | Conexos ganha um código novo em `titVldPagopor` (ex.: 11) ou a Columbia confirma o código de TED | Mapa de rótulos de forma de pagamento (FE + BE), `formaDePagamento`, chips do filtro | Desenvolvimento, pré-deploy | Mudança feita em um só lugar; chip, coluna e filtro refletem sem tocar `page.tsx` nem o hook | <= 1 arquivo por código novo; 0 mapas divergentes |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cópias do mapa `titVldPagopor` -> rótulo | 3 (BE `PAGO_POR_CONEXOS_ROTULO`, FE `FORMA_CONEXOS_ROTULO`, FE `FORMA_ROTULO_TABELA`) | 1 por lado, testada contra o outro | ❌ | `grep -rn FORMA_ROTULO src/frontend/lib/sispag.ts`; `PagoPorConexos.ts` |
| Consumidores de `rotuloFormaConexos` fora do teste | 0 (código morto após o PR) | 0 exportações mortas | ⚠️ | `grep -rn rotuloFormaConexos src/frontend` |
| Arquivos tocados para adicionar uma forma nova | 3 (BE enum, FE `FORMA_ROTULO_TABELA`, FE `FORMA_CONEXOS_ROTULO`) | 1-2 | ⚠️ | análise do diff |
| LOC `sispag/page.tsx` | 1477 (delta líquido -50; badge extraído) | max 600 | ❌ (pré-existente; delta melhora) | `wc -l` |
| LOC `tabela-filtro.tsx` | 463 (+110 no PR) | max 600 | ✅ | `wc -l` |
| Pontos de extensão do hook `useTabelaFiltro` | 3 opt-ins (`getDatas`, `getBoleto`, `getCategoria`); `FiltroBarra` com 5 props opt-in | extensão sem alterar chamadores | ⚠️ | diff `tabela-filtro.tsx` |
| Cobertura de testes do delta | testes novos em hook, badge, filtrosAbas e `formaDePagamento` | todo código novo testado | ✅ | `*.test.ts(x)` no diff |
| Complexidade cognitiva (Biome) | ⚠️ **Não medível aqui**: lint não executado nesta versão --quick. Recomendação: `npm run lint` no gate | <= 15 | ⚠️ | n/a |

Appendix top-10 maiores arquivos / top-10 fan-in de services: ⚠️ **Não medível aqui** (versão pequena, backend fora do escopo; sem `_shared-metrics.md`). O consolidator deve usar o run completo.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Badge extraído de `page.tsx` (~40 linhas inline -> componente); `page.tsx` segue com 1477 LOC | ⚠️ parcial | `FormaPagamentoBadge.tsx`; `page.tsx` |
| Increase Semantic Coherence | Regra "forma de pagamento" concentrada em `formaDePagamento()`, usada por filtro e badge | ✅ presente | `src/frontend/lib/sispag.ts` (`formaDePagamento`) |
| Encapsulate | Hook expõe `getCategoria`/`contagemCategorias`; a page não conhece a regra | ✅ presente | `tabela-filtro.tsx` |
| Use an Intermediary | `getCategoria` e `FormaDePagamento` isolam a UI do código bruto | ✅ presente | `filtrosAbas.ts` |
| Restrict Dependencies | `filtrosAbas.ts` importa de `app/permutas/components/` (sispag depende de pasta de outra frente) | ⚠️ parcial (pré-existente) | `filtrosAbas.ts:1` |
| Refactor | Chip "Boleto" substituído por categoria nos títulos, mas `rotuloFormaConexos` ficou morto | ⚠️ parcial | F-modifiability-2 |
| Abstract Common Services | Hook genérico `useTabelaFiltro<T>` reaproveitado por 2 frentes | ✅ presente | `tabela-filtro.tsx` |
| Defer Binding | Rótulos e ordem em constantes; sem configuração. Código desconhecido não tem chip próprio | ⚠️ parcial | F-modifiability-3 |

## 4. Findings

### F-modifiability-1: Mapa de rótulos `titVldPagopor` triplicado (FE x2 + BE), sem teste de paridade

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services / Increase Semantic Coherence
- **Localização**: `src/frontend/lib/sispag.ts:571` (`FORMA_CONEXOS_ROTULO`), `:593` (`FORMA_ROTULO_TABELA`), `src/backend/domain/interface/sispag/PagoPorConexos.ts` (`PAGO_POR_CONEXOS_ROTULO`)
- **Evidência (objetiva)**:
  ```
  FE FORMA_ROTULO_TABELA  = {1:'cheque',2:'TEF',...,10:'transação automática'}  (minúsculo, sem 6)
  FE FORMA_CONEXOS_ROTULO = (mesmo domínio, caixa alta, com 6)
  BE PAGO_POR_CONEXOS_ROTULO = {1:'CHEQUE',...,10:'TRANSAÇÃO AUTOMÁTICA'}
  ```
- **Impacto técnico**: um código novo ou renomeado exige edição em 3 lugares; esquecer um deixa chip/coluna divergente do resto (drift silencioso). O FE tem hoje dois mapas do mesmo domínio.
- **Impacto de negócio**: o analista vê rótulo diferente do Conexos ou "sem forma no Conexos" para uma forma real; confusão em decisão de pagamento.
- **Métrica de baseline**: 3 cópias, 0 testes de paridade.

### F-modifiability-2: `rotuloFormaConexos` e `FORMA_CONEXOS_ROTULO` ficaram sem consumidor

- **Severidade**: P3
- **Tactic violada**: Refactor
- **Localização**: `src/frontend/lib/sispag.ts:571-587`
- **Evidência (objetiva)**: `grep -rn rotuloFormaConexos src/frontend` retorna só a definição e um comentário (l.39); `page.tsx` deixou de importá-la neste PR.
- **Impacto técnico**: código morto que ainda parece fonte da verdade e induz a editar o mapa errado.
- **Impacto de negócio**: baixo; manutenção mais lenta.
- **Métrica de baseline**: 0 chamadores, ~17 LOC mortas.

### F-modifiability-3: Código desconhecido de `titVldPagopor` cai em "sem forma no Conexos"

- **Severidade**: P2
- **Tactic violada**: Defer Binding (variabilidade futura do ERP não prevista)
- **Localização**: `src/frontend/lib/sispag.ts`, `formaDePagamento` (ramo `rotulo === undefined`)
- **Evidência (objetiva)**: `const rotulo = forma != null ? FORMA_ROTULO_TABELA[forma] : undefined` -> código 11 (ou o de TED, ainda não confirmado) vira chave `sem-forma`, rótulo "sem forma no Conexos", embora o Conexos tenha informado um valor.
- **Impacto técnico**: o filtro funde "forma ausente" e "forma que o FE não conhece"; `forma-<n>` nunca é gerado para código novo.
- **Impacto de negócio**: mensagem enganosa quando o ERP tem forma; o analista pode procurar um problema que não existe.
- **Métrica de baseline**: 1 caminho de fallback para 2 situações distintas; 0 testes com código fora do mapa.

### F-modifiability-4: Hook de filtro compartilhado acumula opt-ins

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies / Split Module
- **Localização**: `src/frontend/app/permutas/components/tabela-filtro.tsx` (`FiltroBarra`, `useTabelaFiltro`)
- **Evidência (objetiva)**: `FiltroBarra` com 5 props opt-in (`rotuloData`, `filtroBoleto`, `tituloBoleto`, `rotuloCategoria`, `dicaCategoria`); `contagemBoleto` e `contagemCategorias` repetem o padrão "contar depois dos outros filtros"; o sentinela `'todas'` é uma string que poderia colidir com uma chave.
- **Impacto técnico**: cada filtro novo reabre um arquivo compartilhado por Permutas e SISPAG (raio de regressão em 2 frentes). Hoje saudável (463 LOC).
- **Impacto de negócio**: baixo; custo cresce a cada filtro.
- **Métrica de baseline**: 3 filtros opt-in, 2 frentes consumidoras, 463 LOC.

## 5. Cards Kanban

### [modifiability-1] Unificar o mapa de formas de pagamento do Conexos e testar paridade FE x BE

- **Problema**
  > O mapa `titVldPagopor` -> rótulo existe em 3 cópias (2 no FE, 1 no BE). Um código novo exige 3 edições e falha em silêncio se uma for esquecida.
- **Melhoria Proposta**
  > Derivar `FORMA_ROTULO_TABELA` de uma única tabela no FE (rótulo canônico + variante curta), remover `FORMA_CONEXOS_ROTULO`/`rotuloFormaConexos` mortos e adicionar teste de paridade que compara os códigos com `PAGO_POR_CONEXOS` do BE (ou fixture compartilhada). Tactic: Abstract Common Services.
- **Resultado Esperado**
  > Adicionar uma forma = 1 arquivo por lado, com CI quebrando em drift. Cópias no FE: 2 -> 1; testes de paridade: 0 -> 1.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-1, F-modifiability-2
- **Métricas de sucesso**:
  - Cópias do mapa no FE: 2 -> 1
  - Testes de paridade FE/BE: 0 -> 1
  - Exportações mortas: 1 -> 0
- **Risco de não fazer**: ao confirmar o código de TED ou o Conexos adicionar forma, chip/coluna mostram rótulo errado em produção.
- **Dependências**: nenhuma.

### [modifiability-2] Distinguir "forma desconhecida" de "sem forma" em `formaDePagamento`

- **Problema**
  > Código de forma não mapeado (ex.: 11) é exibido como "sem forma no Conexos", escondendo que o ERP informou algo.
- **Melhoria Proposta**
  > Quando `forma != null` e fora do mapa, retornar `chave: forma-<n>`, rótulo `forma <n>` (tom neutro); o hook já manda chaves fora da ordem para o fim. Cobrir com teste de código fora do mapa. Tactic: Defer Binding.
- **Resultado Esperado**
  > Códigos novos aparecem como chip próprio sem mudança de código; "sem forma" só quando realmente nulo. Fallbacks distintos: 1 -> 2.
- **Tactic alvo**: Defer Binding
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Testes com código fora do mapa: 0 -> 1
  - Situações distintas por fallback: 2 -> 1
- **Risco de não fazer**: o analista é induzido a erro ao ver "sem forma" em título que tem forma no ERP.
- **Dependências**: nenhuma (pode ir junto do modifiability-1).

### [modifiability-3] Acompanhar o crescimento do hook de filtro compartilhado

- **Problema**
  > `useTabelaFiltro`/`FiltroBarra` ganharam um terceiro opt-in e repetem o padrão de contagem, num arquivo compartilhado por duas frentes.
- **Melhoria Proposta**
  > No próximo filtro novo, extrair um helper de contagem e/ou migrar os opt-ins para um objeto de configuração tipado; mover o hook para `lib/` (hoje sispag importa de `app/permutas/`). Tactic: Restrict Dependencies.
- **Resultado Esperado**
  > Novo filtro = 1 entrada de configuração sem tocar o corpo do hook; import cruzado entre frentes: 1 -> 0.
- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Props opt-in de `FiltroBarra`: 5 -> <= 4
  - Imports sispag -> permutas: 1 -> 0
- **Risco de não fazer**: o arquivo compartilhado vira ponto de regressão cruzada Permutas/SISPAG.
- **Dependências**: fazer junto do próximo filtro novo.

## 6. Notas do agente

- Escopo: apenas o delta de `src/frontend` do PR #115; sem `_shared-metrics.md`, lint, fan-in nem ontologia (--quick). **Sem P0.**
- Pré-existente (nota curta): `sispag/page.tsx` com 1477 LOC (Split Module), embora o PR o reduza em ~50 linhas.
- Cross-QA: drift do mapa FE/BE toca Integrability (contrato com o Conexos); ausência de teste de paridade toca Testability.
