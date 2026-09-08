---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-08-1834
agent: qa-modifiability
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 8.0
findings_count: 5
cards_count: 4
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista/Product Kavex | Nova fonte de dado da tela de permutas (banco/fixture/erro) precisa ser sinalizada e uma quarta fonte (ex.: dado prévio "stale") entra amanhã | `src/frontend/lib/api.ts::fetchGestaoPermutas`, `app/permutas/page.tsx`, `app/permutas/components/banners.tsx`, `lib/features.ts` | Delta em `worktree-permutas-fixture-fonte`, código executando em Next.js/Vercel (frontend legado do template ainda em transição para Lambda alvo) | A troca de origem cai num único `fetchGestaoPermutas` e uma UI de banner isolada; o `DemoDataBanner`/`LoadErrorBanner` só precisa de um novo `fonte` no tipo e um novo componente; nenhum arquivo fora de `permutas/` precisa mudar | Feature nova de "fonte" tocando ≤ 3 arquivos; nenhum ripple para `sispag/` ou `recebimentos/`; ≤ 1 dia de esforço |

O delta encaixa neste cenário: extraiu a UX de origem-do-dado em componentes locais e centralizou a leitura da flag em `lib/features.ts`. Mas o **mesmo cenário aplicado a Recebimentos** (Frente IV) hoje ainda toca `app/recebimentos/page.tsx` direto — a abstração ficou apenas 50% no lugar certo.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC de `app/permutas/page.tsx` (pós-delta) | 1065 | ≤ 600 | ❌ | `wc -l src/frontend/app/permutas/page.tsx` |
| LOC de `app/permutas/page.tsx` (pré-delta) | 1038 (1065 − 27 líquidos do delta) | ≤ 600 | ❌ | `git show origin/main:src/frontend/app/permutas/page.tsx \| wc -l` (aproximado por diff-stat) |
| LOC de `app/permutas/components/banners.tsx` (novo) | 80 | ≤ 150 | ✅ | `wc -l src/frontend/app/permutas/components/banners.tsx` |
| LOC de `lib/features.ts` (pós-delta) | 61 | ≤ 150 | ✅ | `wc -l src/frontend/lib/features.ts` |
| LOC de `lib/auth/env.ts` (co-módulo) | 40 | ≤ 150 | ✅ | `wc -l src/frontend/lib/auth/env.ts` |
| Δ LOC líquido do delta | +558 / −19 (incluindo testes e ontologia) | — | ✅ | `git diff origin/main...HEAD --stat` |
| Δ LOC produtivo (não-teste, não-doc) | +200 / −20 | — | ✅ | idem, excluindo `__tests__/`, `banners.test.tsx`, `ontology/`, `.env.example` |
| Fan-in de `banners.tsx` (`DemoDataBanner`+`LoadErrorBanner`) | 1 (só `permutas/page.tsx`) | ≥ 2 para promover a `components/ui/` | ⚠️ | `grep -rln "from './components/banners'\|@/app/permutas/components/banners" src/frontend` |
| Fan-in do `gestaoPermutasFixture` | 1 (`lib/api.ts`) | ✅ escopo justo | ✅ | `grep -rln gestaoPermutasFixture src/frontend` |
| Duplicação do padrão "banner de erro + retry" | 2 sítios (`permutas/components/banners.tsx::LoadErrorBanner` + `app/recebimentos/page.tsx:380-410` inline) | 1 (componente compartilhado em `components/ui/`) | ⚠️ | `sed -n '380,410p' src/frontend/app/recebimentos/page.tsx` + `banners.tsx:44-79` |
| Duplicação do padrão "flag `NEXT_PUBLIC_*` + `assert…Env` com `LOCAL_ENV`" | 2 sítios (`lib/features.ts:41,45,49-59` + `lib/auth/env.ts:20,29-39`) | 1 fábrica em `lib/env-guard.ts` | ⚠️ | `grep -n LOCAL_ENV src/frontend/lib/features.ts src/frontend/lib/auth/env.ts` |
| Imports no `permutas/page.tsx` | 35 | ≤ 20 (fan-out saudável) | ❌ | `grep -c '^import ' src/frontend/app/permutas/page.tsx` |
| Imports no `banners.tsx` | 3 | ≤ 10 | ✅ | `grep -c '^import ' src/frontend/app/permutas/components/banners.tsx` |
| Imports no `features.ts` | 0 | — | ✅ | `grep -c '^import ' src/frontend/lib/features.ts` |
| Cross-layer violation (frontend importa `src/backend`) | 0 no delta | 0 | ✅ | inspeção de `git diff origin/main...HEAD` |
| Magic numbers em `banners.tsx`/`features.ts`/`usePermutasData.ts` | 0 | 0 | ✅ | leitura dos arquivos do delta |
| Binding time do flag `NEXT_PUBLIC_DEMO_MODE` | **build-time** (assado no bundle Vercel) | build-time é aceitável para demo opt-in | ✅ | `lib/features.ts:22-28` (comentário) + `assertDemoEnv()` |
| Cobertura de testes do módulo `features` | 6 casos (`__tests__/features-demo-mode.test.ts`) | ≥ 3 | ✅ | `_shared-metrics.md` |
| Cobertura de testes de `banners.tsx` | 7 casos | ≥ 3 | ✅ | idem |
| Cobertura dos 3 caminhos de `fetchGestaoPermutas` (banco/fixture/erro) | 7 casos (`permutas-fonte-dado.test.ts`) | ≥ 3 (um por caminho) | ✅ | idem |
| `ontology/_index.json` e `_coverage.json` — drift | ⚠️ **não medível** neste delta (delta não altera `_index.json`/`_coverage.json`, só adiciona `ui-flows/fonte-do-dado-permutas.md`) | 0 drift | N/A | `git diff origin/main...HEAD -- ontology/` |
| Módulos Terraform / tenants | ⚠️ **não medível** (`infra/` não existe) | — | N/A | `_shared-metrics.md` |
| Complexidade cognitiva (Biome) do delta | 0 warnings | 0 no delta | ✅ | `_shared-metrics.md` (`eslint .` exit 0, 0 warnings no delta) |

### Apêndice 2.A — Top-10 maiores arquivos do frontend (contexto de fundo)

Extraído com `find src/frontend/app -name '*.tsx' -o -name '*.ts' | grep -v '\.test\.' | xargs wc -l | sort -rn`.

| # | Arquivo | LOC | Tocado neste delta? |
|---|---|---|---|
| 1 | `src/frontend/app/sispag/page.tsx` | 1068 | não |
| 2 | `src/frontend/app/permutas/page.tsx` | 1065 | **sim (+28/−1)** |
| 3 | `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` | 928 | não |
| 4 | `src/frontend/app/permutas/BorderosPanel.tsx` | 758 | não |
| 5 | `src/frontend/app/recebimentos/page.tsx` | 727 | não (mas ver F-modifiability-2) |
| 6 | `src/frontend/app/sispag/components/LoteCard.tsx` | 557 | não |
| 7 | `src/frontend/app/permutas/components/VisaoGeralTable.tsx` | 486 | não |
| 8 | `src/frontend/app/recebimentos/components/ImportarExtratoDialog.tsx` | 415 | não |
| 9 | `src/frontend/app/operacao/page.tsx` | 376 | não |
| 10 | `src/frontend/app/recebimentos/components/status-badges.tsx` | 348 | não |

Corte defensável (`p95` de arquivo de rota) ~ 600 LOC. **4 dos 10 top-N estão acima do corte** — dívida pré-existente, herdada de `fechamento-processos`. O delta **não piora e não conserta** essa dívida: adiciona 27 linhas líquidas ao arquivo #2 e extrai 80 linhas para o novo `banners.tsx` (fora do arquivo grande). Sinaliza-se em `F-modifiability-1` como P2 justamente porque a métrica de baseline é pré-existente e este delta não é o dono do refactor.

### Apêndice 2.B — Fan-in dos módulos tocados pelo delta

| Módulo | Consumidores atuais | Papel esperado |
|---|---|---|
| `lib/features.ts::isSispagEnabled` | `AuthProvider.tsx`, `app/*/page.tsx` (SISPAG) | flag global |
| `lib/features.ts::isDemoMode`/`assertDemoEnv` (novo) | apenas `lib/api.ts` (1 sítio) | flag global — pronto para expandir para `lib/recebimentos.ts` sem novo módulo |
| `lib/permutas-fixture.ts::gestaoPermutasFixture` | apenas `lib/api.ts` (1 sítio) | ✅ escopo justo |
| `app/permutas/components/banners.tsx::LoadErrorBanner` | apenas `app/permutas/page.tsx` (1 sítio) | **candidato a `components/ui/` — recebimentos usa o mesmo shape inline** |
| `app/permutas/components/banners.tsx::DemoDataBanner` | apenas `app/permutas/page.tsx` (1 sítio) | mantém localidade (tipo `GestaoPermutasResponse['fonte']` acopla ao domínio permutas) |
| `app/permutas/components/usePermutasData.ts` | apenas `app/permutas/page.tsx` (1 sítio) | ✅ hook feature-local |

## 3. Tactics — Cobertura no nf-projects

### Reduce Size of Module

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | Delta extraiu `banners.tsx` (80 LOC) e mantém `usePermutasData.ts` extraído (83 LOC) fora do `page.tsx`. `page.tsx` continua 1065 LOC — a extração destes dois módulos é o único movimento de split que o delta fez. | ⚠️ parcial | `wc -l src/frontend/app/permutas/{page.tsx,components/banners.tsx,components/usePermutasData.ts}` |

### Increase Cohesion

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Semantic Coherence | `banners.tsx` agrupa dois componentes cujo tema é "aviso sobre origem/estado da carga" — coeso. `features.ts` mantém coerente "flags do frontend". `usePermutasData` fala só de estado da tela de permutas. | ✅ presente | `src/frontend/app/permutas/components/banners.tsx:1-80`, `src/frontend/lib/features.ts:1-61` |

### Reduce Coupling

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `isDemoMode()` e `assertDemoEnv()` encapsulam o acesso a `process.env.NEXT_PUBLIC_DEMO_MODE`; o `lib/api.ts` chama `assertDemoEnv()` no import e `isDemoMode()` nos dois pontos de queda. Nenhum outro sítio lê a env crua. | ✅ presente | `src/frontend/lib/features.ts:37`, `src/frontend/lib/api.ts:18-23,96,118` |
| Use an Intermediary | `fetchGestaoPermutas` é o intermediário único entre UI e as três fontes (banco/fixture/erro). Nenhum componente chama `gestaoPermutasFixture` direto. | ✅ presente | `grep -rln gestaoPermutasFixture src/frontend` → só `lib/api.ts`, `lib/permutas-fixture.ts`, `lib/features.ts` (doc), `lib/types.ts`, testes |
| Restrict Dependencies | `DemoDataBanner` recebe `fonte: GestaoPermutasResponse['fonte']` — acopla o componente ao tipo do domínio permutas. Um `fonte: 'fixture' \| 'banco'` genérico permitiria reuso em Recebimentos sem depender do tipo de resposta. | ⚠️ parcial | `src/frontend/app/permutas/components/banners.tsx:23` |
| Refactor | Delta é ele mesmo um refactor local (extraiu banners + hook). Não refatora `page.tsx` (1065 LOC) — fora do escopo deste fix. | ⚠️ parcial | `git diff origin/main...HEAD -- src/frontend/app/permutas/page.tsx` |
| Abstract Common Services | Dois padrões duplicados vivem no repo pós-delta: (a) "banner de erro + retry" (`banners.tsx::LoadErrorBanner` + `recebimentos/page.tsx:380-410` inline); (b) "flag `NEXT_PUBLIC_*` + `assert*Env` com `LOCAL_ENV`" (`features.ts` + `auth/env.ts`). O delta introduziu o segundo par por decisão informada (o comentário em `features.ts:44` explicita o espelhamento), mas isso pede uma fábrica de guarda. | ⚠️ parcial | `sed -n '380,410p' src/frontend/app/recebimentos/page.tsx`; `diff <(sed -n '40,60p' src/frontend/lib/auth/env.ts) <(sed -n '41,60p' src/frontend/lib/features.ts)` |

### Defer Binding

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Configuration files / build-time env | `NEXT_PUBLIC_DEMO_MODE` é lido de `process.env` — binding **build-time** (Vercel assa a env no bundle). Documentado em `.env.example` (+9 linhas do delta) e em `features.ts:22-28`. Aceitável para o caso: demo é opt-in por deploy, ligar/desligar por request seria vulnerabilidade. | ✅ presente (com trade-off consciente) | `src/frontend/lib/features.ts:22-28,37`, `src/frontend/.env.example` |
| Runtime registration / polymorphism | N/A no delta — não é o tipo de decisão que este fix precisava diferir (não há múltiplas implementações de `fetchGestaoPermutas` a escolher em runtime). | N/A | — |
| Plugin patterns | N/A no delta. | N/A | — |

## 4. Findings (achados)

### F-modifiability-1: `permutas/page.tsx` continua acima do corte de tamanho (1065 LOC)

- **Severidade**: P2 (débito técnico defensável — dívida pré-existente, não piorada pelo delta)
- **Tactic violada**: Split Module
- **Localização**: `src/frontend/app/permutas/page.tsx:1-1065`
- **Evidência (objetiva)**:
  ```
  $ wc -l src/frontend/app/permutas/page.tsx
  1065 src/frontend/app/permutas/page.tsx
  $ grep -c '^import ' src/frontend/app/permutas/page.tsx
  35
  ```
  Delta líquido no arquivo: +27 linhas (dos 28 adicionados: 1 import de `banners`, 1 `error` do hook, ~25 de composição condicional dos banners).
- **Impacto técnico**: Cada feature nova em permutas continua tocando um arquivo de mil linhas, com 35 imports, o que amplia o raio de conflito de rebase e torna revisão custosa.
- **Impacto de negócio**: Feature nova em permutas paga um "imposto de arquivo grande" — ~2-4h a mais por PR em navegação + review + resolução de conflito de rebase quando duas features compartilham a tela.
- **Métrica de baseline**: 1065 LOC, 35 imports; alvo p95 ≤ 600 LOC / ≤ 20 imports.

### F-modifiability-2: Padrão "banner de erro + retry" duplicado entre `permutas` e `recebimentos`

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/app/permutas/components/banners.tsx:44-79` (novo do delta) + `src/frontend/app/recebimentos/page.tsx:380-410` (pré-existente, quase idêntico)
- **Evidência (objetiva)**:
  ```
  # permutas/components/banners.tsx (novo)
  <div role="alert" className="flex ... rounded-lg border border-danger/40 bg-danger-subtle ...">
    <AlertTriangle ... />
    <p>... Tentar novamente <Button variant="outline" ... onClick={onRetry}>...</Button>
  # recebimentos/page.tsx:380-410 (inline)
  <div role="alert" className="flex ... rounded-lg border border-danger/40 bg-danger/5 ...">
    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" ... />
    ... "Não foi possível atualizar." ... <Button size="sm" ... onClick={...}>...
  ```
  Recebimentos usa `bg-danger/5`, permutas usa `bg-danger-subtle` — variação visual mínima; a semântica é a mesma "banner destrutivo com retry, dado prévio preservado".
- **Impacto técnico**: Bug fix na UX de erro (ex.: aria-live, cor de contraste, ícone) hoje exige tocar 2 arquivos. Adição de uma 3ª frente (SISPAG hoje não tem esse banner) tenderá a copiar-colar um dos dois.
- **Impacto de negócio**: Design system diverge devagar (uma tela ganha "Tentar novamente" com spinner, outra continua sem). Custo de novo banner em SISPAG ≈ 30min copiando vs 5min consumindo `components/ui/RetryErrorBanner`.
- **Métrica de baseline**: 2 sítios com o mesmo shape; alvo 1 componente em `components/ui/` + N consumidores.

### F-modifiability-3: `features.ts` e `auth/env.ts` duplicam o par `is*Enabled` + `assert*Env`

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/frontend/lib/features.ts:41,45,49-59` + `src/frontend/lib/auth/env.ts:12-14,20,29-39`
- **Evidência (objetiva)**:
  ```
  # auth/env.ts
  export const isDevAuthBypass = (): boolean => process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'
  const LOCAL_ENV = 'local'
  export const assertAuthEnv = (): void => { if (isDevAuthBypass() && process.env.NEXT_PUBLIC_ENV !== LOCAL_ENV) throw new Error(...) }

  # features.ts (novo do delta)
  export const isDemoMode = (): boolean => process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
  const LOCAL_ENV = 'local'
  export const assertDemoEnv = (): void => { if (isDemoMode() && process.env.NEXT_PUBLIC_ENV !== LOCAL_ENV) throw new Error(...) }
  ```
  Duas cópias literais da constante `LOCAL_ENV` e do padrão de guarda; o autor explicitou o espelhamento no comentário (`features.ts:44`).
- **Impacto técnico**: Uma 3ª flag "perigosa em produção" (ex.: um futuro `NEXT_PUBLIC_MOCK_BILLING`) vai copiar-colar pela 3ª vez o mesmo esqueleto de guarda + `LOCAL_ENV`. Uma mudança na definição de "ambiente local" (ex.: aceitar `preview` do Vercel também) exige tocar N arquivos.
- **Impacto de negócio**: Cada flag perigosa nova custa ~10 linhas de código repetido + o risco de esquecer o `assert…Env()` no import do consumidor.
- **Métrica de baseline**: 2 pares hoje; alvo 1 fábrica `createEnvGuard(flagName)` em `lib/env-guard.ts` com N consumidores.

### F-modifiability-4: `DemoDataBanner` acoplado ao tipo `GestaoPermutasResponse['fonte']`

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies
- **Localização**: `src/frontend/app/permutas/components/banners.tsx:23`
- **Evidência (objetiva)**:
  ```
  export function DemoDataBanner({ fonte }: { fonte: GestaoPermutasResponse['fonte'] }) {
  ```
  Tipo acoplado a `GestaoPermutasResponse` do domínio permutas. Se Recebimentos quiser o mesmo banner (o comment de `lib/recebimentos.ts:832-836` diz que o painel "NÃO cai mais em fixture" — política diferente hoje, mas pode voltar), tem que ou reimportar o tipo permutas em recebimentos, ou trocar a assinatura.
- **Impacto técnico**: Um tipo do domínio permutas passeia por qualquer arquivo que reusar o banner.
- **Impacto de negócio**: Barreira baixa (30min de refactor) mas cumulativa: cada componente reusável que vaza um tipo de domínio degrada a modularidade da UI compartilhada.
- **Métrica de baseline**: 1 tipo de domínio na assinatura de um componente candidato a compartilhado; alvo 0.

### F-modifiability-5: `banners.tsx` mora em `app/permutas/components/` mas contém componente genérico

- **Severidade**: P3 (rebaixado de P2 porque `LoadErrorBanner` **ainda tem fan-in 1** — a duplicação com Recebimentos existe mas o banner novo ainda não foi promovido; a decisão de "quando promover" pode esperar o 2º consumidor)
- **Tactic violada**: Increase Semantic Coherence (o módulo mistura `DemoDataBanner` — permutas-específico — com `LoadErrorBanner` — genérico)
- **Localização**: `src/frontend/app/permutas/components/banners.tsx:44-79`
- **Evidência (objetiva)**: `LoadErrorBanner` recebe `{ message, onRetry, retrying, stale }` — nenhuma dependência do domínio permutas. `DemoDataBanner` recebe `fonte: GestaoPermutasResponse['fonte']` — permutas-específico. Convivência num arquivo diz "banners de origem/estado da tela de permutas"; se `LoadErrorBanner` for para `components/ui/`, o arquivo passa a hospedar 1 só componente e o nome perde sentido.
- **Impacto técnico**: Impede que Recebimentos importe `LoadErrorBanner` sem sentir estranheza ("por que estou importando de `permutas/components/`?").
- **Impacto de negócio**: Baixo isoladamente; encadeia com F-modifiability-2 (duplicação persistirá enquanto o banner ficar em `app/permutas/`).
- **Métrica de baseline**: fan-in atual 1; se um 2º consumidor entrar, o custo de mover para `components/ui/` sobe (mais 1 grep-and-replace).

## 5. Cards Kanban

### [modifiability-1] Extrair `LoadErrorBanner` para `components/ui/` e consolidar o banner de erro de Recebimentos

- **Problema**
  > O delta criou `LoadErrorBanner` em `app/permutas/components/banners.tsx:44-79` com o shape "banner destrutivo + retry + dado prévio preservado". `app/recebimentos/page.tsx:380-410` já fazia a mesma coisa inline há mais de um ciclo, com variação visual mínima (`bg-danger/5` vs `bg-danger-subtle`). Um bug fix na UX de erro custa 2 arquivos hoje; uma 3ª tela (SISPAG) copia-cola.
- **Melhoria Proposta**
  > Aplicar **Abstract Common Services**: mover `LoadErrorBanner` para `src/frontend/components/ui/RetryErrorBanner.tsx`, com props genéricas (`message, onRetry, retrying, stale`). Refatorar o bloco inline de `app/recebimentos/page.tsx:380-410` para consumi-lo. Manter `DemoDataBanner` em `app/permutas/components/` (permutas-específico). Alinhar a variação de background com `patterns.md §Error states`.
- **Resultado Esperado**
  > 1 componente em `components/ui/`, 2 consumidores (permutas + recebimentos), 0 blocos inline. Um bug fix futuro na UX de erro toca 1 arquivo.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-2, F-modifiability-4, F-modifiability-5
- **Métricas de sucesso**:
  - Sítios com o shape "banner erro + retry": 2 → 1
  - Fan-in de `RetryErrorBanner`: — → 2
  - LOC em `app/recebimentos/page.tsx`: 727 → ~700 (−27)
- **Risco de não fazer**: em 6 meses SISPAG ganha o mesmo banner por copy-paste; drift visual entre 3 telas; correção de acessibilidade (`aria-live`, contraste) exige N PRs.
- **Dependências**: nenhuma — pode entrar como `/feature-tweak` isolado.

### [modifiability-2] Fatorar `createEnvGuard()` para unificar `features.ts` e `auth/env.ts`

- **Problema**
  > Pós-delta o repo tem **dois** pares quase idênticos: `isDevAuthBypass`+`assertAuthEnv` (`lib/auth/env.ts`) e `isDemoMode`+`assertDemoEnv` (`lib/features.ts`). Ambos duplicam a constante `LOCAL_ENV`, o teste `if (flag && env !== 'local') throw`, e a mensagem de erro. O comentário em `features.ts:44` reconhece explicitamente o espelhamento. Uma 3ª flag perigosa (ex.: mock de billing amanhã) fará 3 cópias.
- **Melhoria Proposta**
  > Aplicar **Abstract Common Services**: criar `src/frontend/lib/env-guard.ts` com `createEnvGuard({ flagName, description, whenNonLocalThrows })` que devolve `{ isEnabled, assertEnv }`. `features.ts` e `auth/env.ts` passam a chamar a fábrica. Manter a semântica exata dos dois erros atuais (mensagens específicas — a lib repassa o `description`).
- **Resultado Esperado**
  > 1 módulo `env-guard.ts` (~30 LOC) + `features.ts` e `auth/env.ts` reduzidos a ~15 LOC cada. Padrão consolidado, pronto para a 3ª flag perigosa.
- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - Sítios com o shape `is*Enabled`+`assert*Env`+`LOCAL_ENV` duplicado: 2 → 1
  - LOC combinada `features.ts`+`auth/env.ts`: 101 → ~70
- **Risco de não fazer**: cada flag `NEXT_PUBLIC_*` perigosa nova replica ~10 linhas + o risco de esquecer o `assert…Env()` no consumidor; convenção não fica óbvia para quem entra depois.
- **Dependências**: nenhuma.

### [modifiability-3] Genericar `DemoDataBanner` para desacoplar do tipo `GestaoPermutasResponse`

- **Problema**
  > `banners.tsx:23` importa `GestaoPermutasResponse` de `lib/types` só para descrever o prop `fonte`. O componente lógico só precisa saber se `fonte === 'fixture'`.
- **Melhoria Proposta**
  > Aplicar **Restrict Dependencies**: trocar a assinatura para `{ fonte: 'fixture' \| 'banco' }` (union literal). Remover o import de `GestaoPermutasResponse`. Manter `DemoDataBanner` em `app/permutas/components/` — o texto do banner segue permutas-específico ("carteira"), mas o **tipo** deixa de vazar.
- **Resultado Esperado**
  > `banners.tsx` fica sem import de tipo de domínio. Pré-requisito ergonômico para uma futura mudança do enum de fonte (ex.: acrescentar `'cache'`) não obrigar a mexer no banner.
- **Tactic alvo**: Restrict Dependencies
- **Severidade**: P3
- **Esforço estimado**: S (≤1d, na verdade <30min)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Imports de tipos de domínio em `banners.tsx`: 1 → 0
- **Risco de não fazer**: qualquer reuso futuro do componente arrasta o tipo permutas junto.
- **Dependências**: nenhuma; combinável com o card modifiability-1.

### [modifiability-4] Split de `app/permutas/page.tsx` — extrair as 5 abas para arquivos irmãos

- **Problema**
  > `page.tsx` tem 1065 LOC e 35 imports pós-delta (crescimento líquido de +27 neste fix). O delta fez a coisa certa extraindo `banners.tsx` e `usePermutasData.ts`, mas o arquivo raiz continua bem acima do corte p95 de 600. Feature nova em permutas paga um imposto grande de navegação e conflito de rebase.
- **Melhoria Proposta**
  > Aplicar **Split Module**: extrair a definição de cada aba (composição do JSX + handlers específicos da aba) de dentro de `GestaoPermutasPage()` para `app/permutas/components/PainelGeral.tsx`, `PainelAutomaticas.tsx`, `PainelMultiplas.tsx`, etc. `page.tsx` fica com o hook, os dialogs dinâmicos e o `<Tabs>` orquestrador. Não mexer nas `AbaAutomaticas.tsx`/`AbaMultiplas.tsx`/... existentes — o alvo é o wrapper de aba, não os componentes de linha.
- **Resultado Esperado**
  > `page.tsx` ≤ 400 LOC, ≤ 20 imports. Cada aba fica testável isoladamente e o custo de PR paralelos em abas diferentes cai.
- **Tactic alvo**: Split Module
- **Severidade**: P2
- **Esforço estimado**: M (2–5d) — refactor com bateria de testes E2E de regressão
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - LOC de `page.tsx`: 1065 → ≤ 400
  - Imports em `page.tsx`: 35 → ≤ 20
  - Suítes de teste por aba: 0 (hoje) → 1 por aba
- **Risco de não fazer**: 3 outras telas idem (`sispag/page.tsx` 1068, `recebimentos/page.tsx` 727, `recebimentos/components/AlocarProcessosDialog.tsx` 928) já sinalizam que o padrão "página gigante" é a norma do repo — sem sair da primeira agora a norma consolida.
- **Dependências**: nenhuma técnica. Deve ser um `/feature-tweak` próprio, **não** encaixado num fix urgente.

## 6. Notas do agente

- Escopo estrito: delta 100% frontend, 10 arquivos, +558/−19 (incluindo testes + doc de ontologia). Nenhum arquivo backend/infra tocado — métricas de Terraform, SSM, Lambda declaradas `não medível` conforme `_shared-metrics.md`.
- Cross-QA links: (a) F-modifiability-2 (banner duplicado) sobrepõe **Integrability** — mesma UX de erro em telas diferentes contradiz o design-system-as-contract; (b) F-modifiability-3 (env-guard duplicado) sobrepõe **Deployability** — cada flag `NEXT_PUBLIC_*` é binding **build-time**, cada novo par sem fábrica é uma superfície de configuração a mais para o pipeline de deploy Vercel; (c) F-modifiability-1 e F-modifiability-4 (page.tsx grande) sobrepõem **Testability** — arquivos de mil linhas com estado composto são caros de testar isoladamente.
- Não medi complexidade cognitiva Biome ad hoc: `_shared-metrics.md` já traz `eslint . → 0 erros, 17 warnings, nenhum em arquivo do delta` — reaproveitado.
- Score 8.0: o delta melhora modifiability líquida (extrai 2 módulos, centraliza flag, adiciona guarda fail-fast e 20 testes) sem introduzir P0/P1; a dívida de tamanho de `page.tsx` é pré-existente e não é o dono deste fix. Score não é 9+ porque o delta perdeu duas oportunidades de fatorar padrões já duplicados no repo (banner de erro, guarda de env).
