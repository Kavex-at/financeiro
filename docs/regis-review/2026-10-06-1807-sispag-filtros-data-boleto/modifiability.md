---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-10-06-1807-sispag-filtros-data-boleto
agent: qa-modifiability
generated_at: 2026-10-06T18:30:00-03:00
scope: all
score: 7.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

> Escopo: DELTA dos commits `65d1fdf` e `da095fa` (filtros de data e boleto nas abas do SISPAG). Não é uma auditoria do repositório inteiro.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor / analista de produto | Pedido de nova aba SISPAG, ou de novo critério de filtro (por exemplo, filtro por banco) | Kit de filtro compartilhado (`tabela-filtro.tsx`), `filtrosAbas.ts`, `page.tsx` do SISPAG, `PaginacaoBoletoDda.ts` | Design time, backend Express e frontend Next.js | A aba nova só declara acessores (`OpcoesFiltroExtra`), sem alterar o kit. Aba que não opta continua idêntica. | ≤ 2 arquivos de produção tocados por aba nova. Zero mudança de comportamento em Permutas e Recebimentos. Zero SQL ou migration. |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos de produção no delta | 11 de 17 (6 de teste/doc) | n/a | ✅ | `git show --stat 65d1fdf da095fa` |
| Superfície de uma nova aba de filtro | 1 acessor em `filtrosAbas.ts` + 1 wiring em `page.tsx` | ≤ 2 arquivos | ✅ | `filtrosAbas.ts:1-75` |
| Consumidores do kit `tabela-filtro` (arquivos não-teste) | 11 (Permutas ×6, Recebimentos ×3, SISPAG ×3, incl. `filtrosAbas.ts`) | n/a (fan-in alto) | ⚠️ | `grep -rln tabela-filtro src/frontend` |
| LOC `tabela-filtro.tsx` | 362 (delta +190 líquido) | p95 ≤ 400 | ✅ (perto do teto) | `wc -l` |
| LOC `sispag/page.tsx` | 1402 (era 1333; delta +69, +5%) | máx ≤ 600 | ❌ (herdado, o delta agrava) | `wc -l`, `git show 65d1fdf~1:...` |
| Imports em `sispag/page.tsx` | 32 | ≤ 15 | ❌ (herdado) | `grep -c '^import '` |
| LOC `routes/sispag.ts` | 1168 (delta +7) | máx ≤ 600 | ❌ (herdado) | `wc -l` |
| LOC `PaginacaoBoletoDda.ts` | 144 | p95 ≤ 400 | ✅ | `wc -l` |
| Violações de camada no delta | 0 (sem SQL, sem acesso a repository/client pelo Express) | 0 | ✅ | `_shared-metrics.md`, PatternGuardian PASS |
| Definições do formato `YYYY-MM-DD` | 2 (backend `DATA_CIVIL_REGEX`, `perfil/periodo.ts`); o frontend do SISPAG usa `filtroDatas.ts` | 1 por runtime | ⚠️ | `grep -rn DATA_CIVIL src` |
| Números mágicos novos em services | 0 | 0 | ✅ | leitura do diff |
| Warnings de complexidade cognitiva novos | Não isolados (86 BE e 21 FE no total, pré-existentes) | 0 novos | ⚠️ Não medível isoladamente | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: dependências cíclicas (madge ausente). O delta só adiciona `import type` de `tabela-filtro` em `filtrosAbas.ts`, e `tabela-filtro` não importa nada de `sispag/`. Não há ciclo introduzido.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | O delta extrai acessores e datas para `filtrosAbas.ts` e `filtroDatas.ts`, em vez de inflar `page.tsx`. Mas `page.tsx` cresceu +69 LOC e chegou a 1402. | ⚠️ parcial | `page.tsx` 1402 LOC; `filtrosAbas.ts` 75 LOC |
| Increase Semantic Coherence | Acessores por aba reunidos num módulo, com rótulo e regra de data juntos (`ROTULO_DATA`). A regra "qual data filtra em cada aba" está em um só lugar. | ✅ presente | `filtrosAbas.ts:11-18` |
| Encapsulate | O kit expõe um contrato estreito e opt-in (`OpcoesFiltroExtra`: `getDatas`/`getBoleto`). No backend, a lógica do intervalo fica dentro de `PaginacaoBoletoDda`. | ✅ presente | `tabela-filtro.tsx`; `PaginacaoBoletoDda.ts:20-30,97-102` |
| Use an Intermediary | Os acessores por aba fazem a mediação entre os tipos de domínio (`TituloAPagar`, `LotePagamento`, `ArquivoRetorno`) e o kit genérico. | ✅ presente | `filtrosAbas.ts:27-70` |
| Restrict Dependencies | O kit não conhece SISPAG (a dependência vai de `sispag` para `permutas/components`). A pasta `permutas/components` virou módulo compartilhado de fato, com 3 domínios consumindo. | ⚠️ parcial | `grep tabela-filtro`: 11 consumidores |
| Refactor | Mudanças aditivas. O comportamento padrão de Permutas é preservado por testes (+139 linhas em `tabela-filtro.test.tsx`). | ✅ presente | `tabela-filtro.test.tsx` |
| Abstract Common Services | O kit de filtro é reutilizado. `DATA_CIVIL_REGEX` fica exportado por `PaginacaoBoletoDda` e é reusado na rota. O frontend tem sua própria conversão de dia civil em `filtroDatas.ts`. | ⚠️ parcial | `routes/sispag.ts:875-876`; `filtroDatas.ts` |
| Defer Binding (configuração) | Qual data cada aba filtra está declarado em tabela (`ROTULO_DATA` + acessores), não espalhado em JSX. Não é configuração externa, mas é binding declarativo em um ponto. | ✅ presente | `filtrosAbas.ts` |
| Defer Binding (polimorfismo / DI) | Backend sem variação em runtime: filtro puro em memória, sem token novo. Aceitável para o escopo. | N/A | Filtro puro, sem I/O |

## 4. Findings

### F-modifiability-1: `sispag/page.tsx` continua crescendo e concentra o wiring de todas as abas

- **Severidade**: P2
- **Tactic violada**: Split Module
- **Localização**: `src/frontend/app/sispag/page.tsx` (1402 LOC, 32 imports)
- **Evidência (objetiva)**:
  ```
  antes (65d1fdf~1): 1333 LOC
  depois (da095fa):  1402 LOC  (+69; diff do arquivo: +74/-5)
  imports: 32
  ```
- **Impacto técnico**: Cada aba nova ou critério novo reabre um arquivo de 1,4k linhas. O delta já extraiu acessores, mas ainda deixa estado, hooks e JSX por aba no mesmo componente. O risco de conflito de merge e de regressão cruzada entre abas é maior.
- **Impacto de negócio**: Cada ajuste de UX no SISPAG custa mais revisão e mais retrabalho em conflitos de merge com sessões paralelas.
- **Métrica de baseline**: 1402 LOC contra alvo de 600 (2,3×). É dívida herdada, e o delta aumentou o arquivo em 5%. Não é P1, porque o delta não criou o problema e o crescimento foi mitigado pela extração.

### F-modifiability-2: o kit de filtro compartilhado mora em `permutas/components` e tem fan-in 11

- **Severidade**: P2
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/frontend/app/permutas/components/tabela-filtro.tsx` (362 LOC), importado por SISPAG, Recebimentos e Permutas
- **Evidência (objetiva)**:
  ```
  grep -rln "tabela-filtro" src/frontend (não-teste): 11 arquivos
  sispag/components/filtrosAbas.ts importa tipo de '@/app/permutas/components/tabela-filtro'
  ```
- **Impacto técnico**: Uma mudança no kit repercute em 3 domínios. O delta tomou o cuidado de ser opt-in e de manter Permutas inalterada, com testes. Mas o caminho do import sugere que o kit pertence a Permutas, e `tabela-filtro.tsx` está em 362 de 400 LOC. As próximas extensões vão estourar o arquivo.
- **Impacto de negócio**: Um ajuste de filtro pedido por uma frente pode quebrar outra se a regressão não for detectada. O risco hoje é baixo graças aos testes de opt-in.
- **Métrica de baseline**: fan-in 11, 362 LOC, e `extras` já no contrato com 2 acessores (`getDatas`, `getBoleto`).

### F-modifiability-3: regra de dia civil existe em duas formas, sem contrato compartilhado entre frontend e backend

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:30`, `src/frontend/app/sispag/components/filtroDatas.ts`, `src/frontend/app/perfil/periodo.ts`
- **Evidência (objetiva)**:
  ```
  backend:  export const DATA_CIVIL_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  frontend: filtroDatas.ts (diaDoErp / diaEmBrasilia) e perfil/periodo.ts com regex própria
  ```
- **Impacto técnico**: O regex só valida o formato, não a data de calendário (`2026-13-45` passa). A comparação por string funciona, e uma data impossível apenas não casa com nada. Ainda assim, uma mudança de formato (por exemplo, aceitar ISO com hora) exigiria mudar 2 a 3 lugares.
- **Impacto de negócio**: Baixo. Risco de divergência silenciosa de filtro entre telas.
- **Métrica de baseline**: 2 definições de regex do formato no código-fonte, nenhuma compartilhada entre frontend e backend (monorepo sem pacote comum).

### F-modifiability-4: filtro DDA é em memória sobre o conjunto consolidado, e o contrato de paginação acumula parâmetros

- **Severidade**: P3
- **Tactic violada**: Encapsulate
- **Localização**: `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts:20-30,97-102`, `BoletoDdaService.ts`, `routes/sispag.ts:875-876`
- **Evidência (objetiva)**:
  ```
  filtro: { ...; vencimentoDe?: string; vencimentoAte?: string }
  const temIntervalo = vencimentoDe !== undefined || vencimentoAte !== undefined;
  ```
- **Impacto técnico**: Hoje é pequeno e coeso (144 LOC), e como não há SQL, uma troca do schema não propaga. Cada critério novo, porém, passa pela rota, pelo service e pelo `filtro` manualmente (3 pontos de edição por parâmetro). Se o critério migrar para SQL, a assinatura muda em todos eles.
- **Impacto de negócio**: Nenhum hoje. Evita custo futuro se o volume de boletos crescer.
- **Métrica de baseline**: 3 pontos de edição por novo parâmetro de filtro DDA.

## 5. Cards Kanban

### [modifiability-1] Extrair o wiring de filtros por aba de `sispag/page.tsx`

- **Problema**
  > `sispag/page.tsx` tem 1402 LOC e 32 imports, e cresceu 69 linhas neste delta. Cada aba nova ou critério novo de filtro reabre o mesmo arquivo, o que aumenta conflitos de merge e regressões cruzadas entre abas.

- **Melhoria Proposta**
  > Split Module: mover cada aba (REM, RET, Finalizados, Candidatos) para um componente próprio em `src/frontend/app/sispag/components/`, como `BoletosDdaTab.tsx` já faz. Manter em `page.tsx` só a navegação e o estado compartilhado. Fazer de forma incremental, a cada `/feature-tweak` que tocar a aba, conforme a política de migração proporcional.

- **Resultado Esperado**
  > `page.tsx` abaixo de 700 LOC (alvo final 600) e abaixo de 20 imports. Nova aba de filtro toca no máximo 2 arquivos.

- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC de `sispag/page.tsx`: 1402 → ≤ 700
  - Imports de `sispag/page.tsx`: 32 → ≤ 20
- **Risco de não fazer**: Em 6 meses o arquivo passa de 1,6k LOC, e cada ajuste do SISPAG, que é a frente com mais feedback de produção, vira conflito de merge.
- **Dependências**: nenhuma. Fazer junto com a próxima mudança na aba afetada.

### [modifiability-2] Promover o kit de filtro para módulo compartilhado e dividir por responsabilidade

- **Problema**
  > `tabela-filtro.tsx` está em `permutas/components`, é usado por 11 arquivos de 3 domínios e já tem 362 LOC. O próximo critério de filtro o leva acima de 400 e o caminho do import induz a erro sobre quem é o dono.

- **Melhoria Proposta**
  > Restrict Dependencies + Split Module: mover para `src/frontend/components/` (por exemplo `tabela-filtro/`) e separar o hook `useTabelaFiltro` da `FiltroBarra` (UI). Manter reexport em `permutas/components/tabela-filtro.tsx` durante a transição, para não quebrar imports. Preservar os testes de opt-in existentes.

- **Resultado Esperado**
  > Kit com dono explícito, cada arquivo abaixo de 250 LOC, e 0 imports de `sispag/` ou `recebimentos/` apontando para `permutas/`.

- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Imports cross-domínio para `permutas/components/tabela-filtro`: 6 (SISPAG ×3, Recebimentos ×3) → 0
  - LOC por arquivo do kit: 362 → ≤ 250
- **Risco de não fazer**: Mudança de filtro numa frente quebra outra sem que o dono perceba. O arquivo ultrapassa o p95 de 400 LOC.
- **Dependências**: nenhuma. Fazer antes de uma terceira extensão do kit.

### [modifiability-3] Centralizar o contrato de dia civil e documentar o critério de filtro DDA

- **Problema**
  > O formato `YYYY-MM-DD` é validado com regex próprio no backend (`DATA_CIVIL_REGEX`) e em `perfil/periodo.ts`, sem validação de calendário. Cada critério novo do DDA exige editar rota, service e `filtro` manualmente.

- **Melhoria Proposta**
  > Abstract Common Services: validar a data de calendário no Zod do backend (por exemplo, `refine` com `Date.parse`) e reaproveitar o mesmo schema nas rotas que aceitem dia civil. No frontend, reaproveitar `filtroDatas.ts` em `perfil/periodo.ts`. Agrupar os parâmetros de filtro DDA em um schema Zod único, derivado do tipo `filtro`.

- **Resultado Esperado**
  > 1 definição do formato por runtime. Novo critério DDA editado em 1 schema em vez de 3 pontos.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3, F-modifiability-4
- **Métricas de sucesso**:
  - Definições do regex de data civil: 2 → 1 por runtime
  - Pontos de edição por parâmetro DDA: 3 → 1
- **Risco de não fazer**: Divergência silenciosa de formato entre telas. Custo marginal, mas cresce a cada filtro novo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo limitado ao delta. Não rodei o ranking de top-10 de arquivos/fan-in para o repositório inteiro (fora do delta): ver apêndice abaixo com os valores do delta e dos arquivos tocados.
- Não encontrei P0. O delta é aditivo, opt-in, sem SQL e sem nova dependência. As três dívidas grandes (`page.tsx` 1402 LOC, `routes/sispag.ts` 1168 LOC, 32 imports) são herdadas.
- Cross-QA: `page.tsx` com 1402 LOC dificulta a testabilidade (Testability); a aba DDA filtra em memória, o que toca Performance se o volume crescer.

**Apêndice (arquivos do delta, maiores primeiro)**

| Arquivo | LOC |
|---|---|
| `src/frontend/app/sispag/page.tsx` | 1402 |
| `src/backend/routes/sispag.ts` | 1168 |
| `src/frontend/app/permutas/components/tabela-filtro.tsx` | 362 |
| `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` | 144 |
| `src/frontend/app/sispag/components/filtrosAbas.ts` | 75 |
| `src/frontend/app/sispag/components/filtroDatas.ts` | 31 |

Fan-in do único módulo compartilhado tocado: `tabela-filtro.tsx` = 11 arquivos de produção. Os services do delta (`BoletoDdaService`, `PaginacaoBoletoDda`) têm fan-in baixo, restrito à rota e ao teste.
