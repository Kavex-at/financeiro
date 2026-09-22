---
qa: Testability
qa_slug: testability
run_id: 2026-09-22-1556
agent: qa-testability
generated_at: 2026-09-22T15:56:00-03:00
scope: frontend
score: 7.5
findings_count: 2
cards_count: 1
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Baixar .REM" no `LoteCard` | backend devolve o arquivo CNAB 240 em bytes latin1 (favorecido com acento) | `baixarRemessa` (`src/frontend/lib/sispag.ts`) + wiring de download em `LoteCard.tsx` | dev/CI, `npm test` no worktree | teste automatizado força os bytes latin1 pelo boundary mockado e assevera que chegam intactos ao `Blob`, sem depender de re-encoding UTF-8 | 100% dos bytes de entrada == bytes no `Blob` produzido; suíte roda sem I/O real |

Esta é uma revisão de **delta** (fix de bug: `res.text()` decodificava UTF-8 e corrompia colunas fixas do CNAB 240; a correção troca para `res.blob()` e entrega o `Blob` direto ao `URL.createObjectURL`). O cenário acima é exatamente o que `sispag.test.ts` (novo) exercita.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de teste do delta — `baixarRemessa` (lib) | 2/2 casos (bytes latin1 intactos; 404) | ≥1 caso feliz + ≥1 caso de erro por função nova/alterada | ✅ | `src/frontend/lib/sispag.test.ts` |
| Cobertura de teste do delta — wiring em `LoteCard.tsx` (`onClick` → `URL.createObjectURL` → `a.click()` → `revokeObjectURL`) | 0 casos | ≥1 teste de componente exercitando o clique | ❌ | `find src/frontend/app/sispag -iname '*.test.*'` → vazio |
| `npx jest lib/sispag.test.ts` | 1 suite, 2 testes, PASS | verde | ✅ | comando executado nesta revisão |
| Coverage threshold global (frontend, `jest.config.js`) | lines 33% / branches 23% / functions 28% (piso, não medição do delta — `--quick`, sem `--coverage` rodado) | gate travando regressão | ✅ presente | `src/frontend/jest.config.js:37-41` |
| CI executa testes de frontend | `npm test -- --coverage` no job `frontend` | bloqueante no merge | ✅ | `.github/workflows/ci.yml:80` |
| Rede real em teste do delta | 0 (`apiFetch` mockado via `jest.mock('@/lib/http')`) | 0 | ✅ | `src/frontend/lib/sispag.test.ts:1-9` |

> ⚠️ **Não medível localmente com precisão de delta**: cobertura de linha/branch específica de `LoteCard.tsx` antes/depois do diff — `--quick` não roda `--coverage`, e o arquivo já tinha 0% de cobertura de componente antes deste PR (nenhum `LoteCard.test.tsx` existe hoje). O card abaixo assume esse baseline de 0%.

## 3. Tactics — Cobertura no financeiro (delta)

| Tactic (Bass) | Implementação atual no delta | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `apiFetch` como boundary HTTP único, mockável por `jest.mock('@/lib/http')` sem tocar rede | ✅ presente | `src/frontend/lib/sispag.test.ts:2` |
| Recordable Test Cases | Teste novo fixa um caso de regressão real e documentado: bytes de "JOÃO ÇA" em latin1 vs. o que `res.text()` produziria (mostra o defeito que motivou o fix) | ✅ presente — exemplar | `src/frontend/lib/sispag.test.ts:14-31` |
| Sandbox | `jsdom` isola o teste do navegador real; sem I/O de arquivo ou rede | ✅ presente | `jest.config.js testEnvironment: 'jsdom'` |
| Executable Assertions | `expect(Array.from(await lerBytes(arquivo))).toEqual(Array.from(bytes))` — assevera bytes exatos, não só "não lança erro" | ✅ presente | `src/frontend/lib/sispag.test.ts:29` |
| Abstract Data Sources | `withAuthHeaders` e `apiFetch` mockados, isolando a função pura de auth/rede | ✅ presente | `src/frontend/lib/sispag.test.ts:3` |
| Limit Structural Complexity | Função testada isoladamente (14 LOC); mas o `onClick` em `LoteCard.tsx` mistura chamada de rede + efeito de DOM (`URL.createObjectURL`, `a.click()`, `revokeObjectURL`) inline, sem seam própria | ⚠️ parcial | `src/frontend/app/sispag/components/LoteCard.tsx:306-322` |
| Limit Non-Determinism | Sem `Date`/`Math.random` no delta | N/A — não aplicável a este diff | — |

## 4. Findings (achados)

### F-testability-1: wiring de download no `LoteCard` (`URL.createObjectURL` → `a.click()` → `revokeObjectURL`) segue sem nenhum teste de componente

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity / Specialized Interfaces
- **Localização**: `src/frontend/app/sispag/components/LoteCard.tsx:306-322`
- **Evidência (objetiva)**:
  ```
  $ find src/frontend/app/sispag -iname "*.test.*"
  (vazio)
  ```
  O `onClick` do botão "Baixar" é o único ponto que consome o retorno de `baixarRemessa` e o converte em efeito observável no navegador (download real). O teste novo cobre `baixarRemessa` isoladamente (bytes corretos saindo da função), mas nada exercita o clique real: se alguém reintroduzir `new Blob([arquivo], {type: 'text/plain;charset=latin1'})` em volta do `Blob` já correto (reencodando-o de novo), nenhum teste pega.
- **Impacto técnico**: regressão futura no wiring do componente (não na função `lib/`) passaria pelo CI verde. Também: `jsdom` não implementa `URL.createObjectURL` por padrão (lança "not implemented"), então o dia que alguém tentar escrever esse teste vai precisar polyfillar — vale documentar agora, não na hora do incidente.
- **Impacto de negócio**: mesma classe de bug que motivou este PR (remessa CNAB 240 corrompida, banco recusa ou lê colunas erradas) pode voltar por um ponto de regressão que o teste atual não defende — o teste defende a função, não o fluxo do analista.
- **Métrica de baseline**: cobertura de teste de componente em `src/frontend/app/sispag/components/`: 0 arquivos `*.test.tsx` (pré-existente; o delta não piora, mas também não fecha a lacuna no exato trecho que ele reescreve).

### F-testability-2: teste novo de `baixarRemessa` é um exemplo forte de Recordable Test Case — nenhum ajuste necessário

- **Severidade**: P3 (nota positiva, não gera card de melhoria)
- **Tactic violada**: nenhuma — tactic bem aplicada
- **Localização**: `src/frontend/lib/sispag.test.ts:1-44`
- **Evidência (objetiva)**: o teste fixa os bytes exatos do defeito histórico (`0xc3`, `0xc7` — Ã/Ç em latin1) e o contraste explícito com o que `res.text()` produziria (`'JO�O �A\r\n'`), documentando o bug no próprio teste.
- **Impacto técnico**: nenhum — reforça a defesa da tactic.
- **Impacto de negócio**: nenhum — reduz o custo de teste futuro nesse boundary.
- **Métrica de baseline**: `lib/sispag.test.ts` passa de 0 → 2 casos cobrindo `baixarRemessa` (função nova/alterada neste delta).

## 5. Cards Kanban

### [testability-1] Cobrir o wiring de download do `LoteCard` com um teste de componente

- **Problema**
  > O fix troca `res.text()` por `res.blob()` e o `onClick` do botão "Baixar" em `LoteCard.tsx:306-322` entrega esse `Blob` direto a `URL.createObjectURL`. O teste novo cobre a função `baixarRemessa` isoladamente, mas nenhum teste exercita o clique real do componente — o ponto exato onde uma reintrodução do bug (reencodar o `Blob` em string no meio do caminho) passaria despercebida pelo CI.

- **Melhoria Proposta**
  > Adicionar `LoteCard.test.tsx` (Testing Library) cobrindo o clique em "Baixar": mock de `baixarRemessa` retornando um `Blob` de bytes conhecidos, spy em `URL.createObjectURL`/`URL.revokeObjectURL` (polyfill necessário em `jest.setup.ts`, já que `jsdom` não implementa `createObjectURL` nativamente) e assert de que o `Blob` passado é o mesmo objeto — sem reconstrução intermediária. Tactic: Specialized Interfaces (expor o polyfill de `URL.createObjectURL` como utilitário reusável em `jest.setup.ts`, como já existe para `ResizeObserver`).

- **Resultado Esperado**
  > Testes de componente em `src/frontend/app/sispag/components/`: 0 → ≥1 arquivo cobrindo o fluxo de download do `.REM`. Cobertura de linha de `LoteCard.tsx` no relatório `--coverage` sobe a partir do baseline atual (não medido nesta rodada `--quick`; a rodada com `--coverage` do CI é a referência).

- **Tactic alvo**: Specialized Interfaces / Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Testes de componente em `app/sispag/components/`: 0 → ≥1
  - `jest.setup.ts`: polyfill de `URL.createObjectURL`/`revokeObjectURL` ausente → presente (reusável por outras telas que baixam arquivo, ex. futura Frente IV)
- **Risco de não fazer**: o mesmo bug de encoding corrompendo CNAB 240 (já ocorreu em produção, ver commit `ca094fb`) pode reaparecer no wiring do componente sem que o CI acuse — o teste atual só defende a metade "de baixo" do fluxo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: revisão delta-only conforme `_shared-metrics.md` (3 arquivos de código: `sispag.ts`, `LoteCard.tsx`, `sispag.test.ts`). `--quick` — não rodei `--coverage` completo, só o teste do arquivo tocado (`npx jest lib/sispag.test.ts`, 2/2 verde).
- Nenhum P0/P1: o delta é um bug fix bem coberto na função `lib/` alterada; o gap encontrado (wiring do componente) é P2 porque é uma lacuna pré-existente (nenhum `LoteCard.test.tsx` nunca existiu) que o delta toca mas não piora.
- Cross-QA: F-testability-1 conecta com **Fault Tolerance** (o bug original — CNAB corrompido rejeitado pelo banco — é um cenário de fault tolerance; o teste de componente proposto fecha a mesma lacuna de observabilidade de falha) e com **Integrability** (o `Content-Disposition`/`filename` parseado em `sispag.ts:459` é um contrato implícito com o backend, hoje só coberto no boundary de bytes, não no de nome de arquivo dentro do componente).
