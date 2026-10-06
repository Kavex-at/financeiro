---
qa: Testability
qa_slug: testability
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-testability
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / CI | Mudança no filtro de data/boleto das abas SISPAG (delta 65d1fdf + da095fa) | `PaginacaoBoletoDda`, rota `GET /sispag/boletos-dda`, `tabela-filtro.tsx`, `filtrosAbas.ts`, `filtroDatas.ts`, `sispag/page.tsx` | Desenvolvimento / CI (jest, jsdom) | Regressão do filtro (dia errado por fuso, intervalo exclusivo, boleto sem vencimento) é detectada por teste automatizado antes do merge | Cada regra do filtro com ≥1 teste determinístico; gates verdes (BE 4010, FE 859 testes) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| 1. Cobertura por camada (delta) | Lógica pura nova (`PaginacaoBoletoDda`, `filtroDatas`, `filtrosAbas`, extras do `useTabelaFiltro`) com testes dedicados; wiring em `sispag/page.tsx` (+78 linhas) sem teste no nível de página | Lógica pura ≥ 80%; wiring coberto por ao menos 1 teste de página por aba | ⚠️ | `git show --stat 65d1fdf`; `grep` em `page.test.tsx` (0 ocorrências de filtro/REM/"Data de crédito"/"Recebido em") |
| Testes adicionados no delta | 4 arquivos de teste tocados/novos, +327 linhas; ~31 `it(` nos arquivos frontend (`filtrosAbas` 6, `filtroDatas` 5, `tabela-filtro` 10, `BoletosDdaTab` 10) mais casos em `PaginacaoBoletoDda.test.ts` e `routes/sispag.test.ts` | ≥1 teste por regra nova | ✅ | `grep -c "it("` |
| Razão teste/fonte no delta | Fontes novos/alterados com teste direto: 6 de 9 (`page.tsx`, `date-picker.tsx`, `lib/sispag.ts` sem teste direto) | ≥ 0.5 | ✅ | `git show --stat` |
| Gates | BE 223 suites / 4010 ok; FE 86 suites / 859 ok | 100% verde | ✅ | `_shared-metrics.md` |
| Pisos de cobertura no CI | BE global 72/54/78, `domain/service` 88/60; FE global 33/23/28; CI roda `npm test -- --coverage` | Gate bloqueante presente | ✅ (piso FE baixo) | `src/backend/jest.config.cjs:39`, `src/frontend/jest.config.js:41`, `.github/workflows/ci.yml:29,82` |
| Leituras de relógio não injetáveis no delta | 0 `Date.now()`; `new Date(ms)` só em conversão pura de valor recebido (`filtroDatas.ts:22,28`); Intl com fuso explícito `America/Sao_Paulo` | 0 leituras do relógio | ✅ | `grep "new Date\|Date.now"` nos arquivos do delta |
| Aleatoriedade / rede em testes do delta | 0 / 0 | 0 | ✅ | inspeção do diff |
| Teste de entrada hostil na rota | Presente (`vencimentoDe=01/10/2026`, `…'%20OR%201=1`) | presente | ✅ | `src/backend/routes/sispag.test.ts:1047-1048` |
| Testes property-based no delta | 0 (`fast-check` ausente em `app/sispag` e `permutas/components`) | opcional | ⚠️ | `grep -rn fast-check` |
| Tamanho dos arquivos | maior teste do delta: `tabela-filtro.test.tsx` 139 linhas (ok); `sispag/page.tsx` 1402 linhas | < 500 | ⚠️ (page.tsx) | `wc -l` |
| Cobertura numérica por diretório | ⚠️ **Não medível localmente no delta**: `--coverage` não executado (run focado no delta). Recomendação: ler o relatório de coverage do job de CI do PR. | — | ⚠️ | — |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | Funções puras exportadas (`diaDoErp`, `diaEmBrasilia`, accessors por aba, `PaginacaoBoletoDda`) testáveis sem render | ✅ presente | `filtroDatas.ts`, `filtrosAbas.ts` |
| Recordable Test Cases | Sem fixtures gravadas; testes usam literais. Delta não toca client externo | N/A — sem integração nova | `_shared-metrics.md` |
| Sandbox | Sem I/O novo; filtro é em memória | N/A — sem efeito colateral a isolar | diff |
| Executable Assertions | Zod regex na borda; `DATA_CIVIL_REGEX` compartilhado entre rota e serviço | ⚠️ parcial (regex não valida data real, F-testability-2) | `routes/sispag.ts` `boletosDdaSchema` |
| Abstract Data Sources | Serviço recebe linhas já carregadas; filtro não toca banco | ✅ presente | `PaginacaoBoletoDda.ts` |
| Limit Structural Complexity | Lógica extraída em módulos puros e opt-in no kit (`extras`), mas `sispag/page.tsx` com 1402 linhas concentra o wiring | ⚠️ parcial | `wc -l page.tsx` |
| Limit Non-Determinism | Fuso fixo (`America/Sao_Paulo`), dia ERP lido em UTC, sem relógio nem aleatoriedade | ✅ presente | `filtroDatas.ts:9-31` |

## 4. Findings

### F-testability-1: Wiring das abas em `sispag/page.tsx` sem teste de página

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/frontend/app/sispag/page.tsx` (+78/-16 no delta), `src/frontend/app/sispag/page.test.tsx`
- **Evidência (objetiva)**:
  ```
  grep -n "REM|Data de crédito|Recebido em|filtro" src/frontend/app/sispag/page.test.tsx  -> 0 resultados
  page.test.tsx não consta em `git show --stat 65d1fdf`
  ```
- **Impacto técnico**: a aba REM ganhou filial/busca/data + paginação + coluna "Data de crédito"; RET ganhou coluna "Recebido em". Ligar o accessor errado a uma aba passa nos testes unitários dos accessors e só falha em tela.
- **Impacto de negócio**: a analista filtra por intervalo e vê lista incompleta sem erro visível; retrabalho de conferência manual.
- **Métrica de baseline**: 0 testes de página para os filtros de 5 abas.

### F-testability-2: Regex aceita datas civis impossíveis; intervalo invertido sem asserção

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `PaginacaoBoletoDda.ts` (`DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/`), `routes/sispag.ts` `boletosDdaSchema`
- **Evidência (objetiva)**:
  ```
  '2026-13-45' casa com o regex; a comparação é por string, então não quebra, mas devolve 0 linhas sem 400.
  Testes de rota cobrem formato (DD/MM/YYYY, injeção), não mês/dia inexistente nem de > ate.
  ```
- **Impacto técnico**: entrada inválida vira resposta vazia silenciosa em vez de 400, sem asserção.
- **Impacto de negócio**: baixo; resultado vazio confunde, sem risco financeiro (leitura em memória, sem SQL).
- **Métrica de baseline**: 0 testes para data inexistente / intervalo invertido.

### F-testability-3: Filtro de intervalo sem teste property-based

- **Severidade**: P3
- **Tactic violada**: Limit Structural Complexity (espaço de entrada)
- **Localização**: `PaginacaoBoletoDda.test.ts`, `filtrosAbas.test.ts`
- **Evidência (objetiva)**: `grep -rn fast-check` em `app/sispag` e `app/permutas/components` -> 0; a dep existe no frontend.
- **Impacto técnico**: inclusividade nas bordas e conversão de fuso testadas só por exemplos escolhidos à mão.
- **Impacto de negócio**: baixo; erro de borda de 1 dia em vencimento é o tipo de bug percebido tarde.
- **Métrica de baseline**: 0 propriedades no delta.

## 5. Cards Kanban

### [testability-1] Cobrir o wiring de filtros por aba em `sispag/page.test.tsx`

- **Problema**
  > O wiring dos filtros de data/boleto de cada aba SISPAG em `page.tsx` não tem teste de página; só os accessors puros são testados. Trocar o accessor de uma aba passa verde.
- **Melhoria Proposta**
  > Adicionar a `page.test.tsx` um caso por aba (títulos, candidatos, finalizados, REM, RET) que aplica um intervalo e afirma que só a linha da data correta permanece; extrair o wiring da aba REM para componente próprio se o teste ficar pesado.
- **Resultado Esperado**
  > Testes de página com filtro 0 → 5; accessor trocado é detectado em CI.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - testes de página por filtro de aba: 0 → 5
  - `page.tsx` linhas: 1402 → < 1300 (se extrair REM)
- **Risco de não fazer**: filtro errado em uma aba chega a produção sem sinal; cada nova coluna repete o risco.
- **Dependências**: nenhuma

### [testability-2] Validar data civil real e intervalo invertido em `/sispag/boletos-dda`

- **Problema**
  > O regex só checa formato; `2026-13-45` ou `de > ate` retornam lista vazia sem erro nem teste.
- **Melhoria Proposta**
  > Refinar o Zod (`.refine` com parse de data real, `de <= ate`) e adicionar casos em `routes/sispag.test.ts` e `PaginacaoBoletoDda.test.ts`.
- **Resultado Esperado**
  > Casos de entrada inválida na rota 2 (formato) → 4 (formato + data inexistente + invertido); respostas 400 explícitas.
- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - casos inválidos testados na rota: 2 → 4
- **Risco de não fazer**: resultados vazios silenciosos geram chamados de suporte.
- **Dependências**: nenhuma

### [testability-3] Adicionar propriedades fast-check ao filtro de intervalo

- **Problema**
  > Bordas de inclusividade e fuso são cobertas só por exemplos manuais.
- **Melhoria Proposta**
  > Propriedade: para qualquer conjunto de datas e intervalo, o resultado equivale a um oráculo ingênuo `filter(de <= d <= ate)`; e `diaEmBrasilia` estável entre 00:00 e 23:59 BRT.
- **Resultado Esperado**
  > Propriedades no delta 0 → 2; uso de `fast-check` em `app/sispag` 0 → 1 arquivo.
- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - propriedades: 0 → 2
- **Risco de não fazer**: erro de borda de um dia continua dependendo do exemplo escolhido.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: apenas o delta; `--coverage` não executado (cobertura por diretório não medível aqui, declarado na seção 2).
- Nenhum P0/P1: filtro em memória, sem SQL, sem escrita Conexos, lógica nova com testes determinísticos.
- Cross-QA: Limit Non-Determinism (fuso fixo) liga a Modifiability; F-testability-2 liga a Security (validação na borda).
